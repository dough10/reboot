'use strict';


class Rebooter {

  constructor(config, mongooseConfig) {
    // early return of "config" is not a Object
    if (typeof config !== 'object') {
      throw new Error('Config must be an Object');
      return;
    }
    this.config = config;
    this._mongoose = require('mongoose');
    this._mongodb = this._mongoose.connection;
    this._mongodb.on('error', console.error);
    this._mongodb.once('open', _ => {
      this._print('Mongoose Connection Open');
      this._routerIP = false;
      this.fs = require('fs');
      this._network = require('network');
      this.onoff = require('onoff').Gpio;
      this.SSH = require('simple-ssh');
      const _express = require('express');
      const _app = _express();
      const _compression = require('compression');
      const _server = _app.listen(config.port);
      const bcrypt = require('bcrypt');
      const tokenAuth = require('jsonwebtoken');
      const authenticator = require('authenticator');
      this._socket = require('socket.io')(_server);
      this._socket.on('connection', _socket => {
        _socket.on('force-reboot', token => {
          if (!token) {
            this._emit('toast', 'login required');
            return;
          }
          tokenAuth.verify(token, config.hashKey, (err, decoded) =>{
            if (err) {
              this._emit('toast', 'invalid token');
              return;
            }
            if (!decoded) {
              this._emit('toast', 'invalid token');
              return;
            }
            this._rebootRouter('manual', decoded.username);
          });
        });
        _socket.on('count', host => this._count(host).then(count => this._emit('count', count)));
        _socket.on('log', obj => this._getLogs(obj.host, obj.skip, obj.limit).then(log => this._emit('log', log)));
        _socket.on('login', login => {
          this._users.findOne({
            username: login.username
          }, (err, user) => {
            if (!user) {
              this._emit('toast', 'login failed');
              return;
            }
            if (!bcrypt.compareSync(login.password, user.password)) {
              this._emit('toast', 'login failed');
              return;
            }
            if (user.twoFactor) {
              _socket.emit('twoFactor');
              return;
            }
            const token = tokenAuth.sign(user, this.config.hashKey, {
              expiresIn: '24h'
            });
            _socket.emit('login', token);
            _socket.emit('toast', 'Successful Login');
          });
        });
        _socket.on('twoFactor', twoFactor => {
          this._users.findOne({
            username: twoFactor.username
          }, (err, user) => {
            if (!user) {
              this._emit('toast', 'login failed');
              return;
            }
            if (!authenticator.verifyToken(user.authKey, twoFactor.code)) {
              this._emit('toast', 'login failed');
              return;
            }
            const token = tokenAuth.sign(user, this.config.hashKey, {
              expiresIn: '24h'
            });
            _socket.emit('login', token);
            _socket.emit('toast', 'Successful Login');
          });
        });
        this._pushRestarts();
        this._pushHistory();
        // one off ping to shorten the delay for router status
        // without could take +30 seconds to get status
        this._network.get_gateway_ip((err, ip) =>
          this._ping(ip).then(res =>
            this._emit('router-status', res)));
      });

      this.PingWrapper = require ("ping-wrapper");
      this.PingWrapper.configure();

      const historySchema = this._mongoose.Schema({
        address: String,
        data: Object,
        time: Number
      });

      this._history = this._mongoose.model('logs', historySchema);

      this._history.insert = (data, cb) => {
        const insert = new this._history(data);
        insert.save(data, cb);
      };


      const restartsSchema = this._mongoose.Schema({
        time: Number,
        type: String
      });

      this._restarts = this._mongoose.model('restarts', restartsSchema);

      this._restarts.insert = (data, cb) => {
        const insert = new this._history(data);
        insert.save(data, cb);
      };

      const usersSchema = this._mongoose.Schema({
        username: String,
        password: String,
        authKey: String,
        twoFactor: Boolean
      });

      this._users = this._mongoose.model('users', usersSchema);

      _app.use(_compression());
      _app.disable('x-powered-by');

      _app.use(_express.static(__dirname + '/html', {
        maxAge: (60000 * 60) * 24
      }));

      _app.get('/count/:host', (req, res) => {
        let host = req.params.host;
        if (!host) {
          res.status(500).send({
            status: 500,
            host: host,
            error: 'invalid host'
          });
          return;
        }
        this._count(host)
        .then(count =>
          res.status(count.status).send(count));
      });


      _app.get('/log/:host/:skip/:limit', (req, res) => {
        let host = req.params.host;
        let skip = parseInt(req.param.skip, 10);
        let limit = parseInt(req.param.limit, 10);
        this._getLogs(host, skip, limit)
        .then(logs =>
          res.status(logs.status).send(logs));
      });



      this._hasRebooted = false;
      this._failedRouterPings = 0;

      this._addresses = this.config.addresses;
      this._responses = [];
      this.start();
    });
    this._mongoose.connect('mongodb://' + mongooseConfig.host + ':' + mongooseConfig.port + '/' + mongooseConfig.db);
  }


  /**
   * check if given addres is valid
   *
   * @param {String} host - ip / url address
   */
  _isValidHost(host) {
    for (let i = 0; i < this._addresses.length; i++) {
      if (host === this._addresses[i]) return true;
    }
    return false;
  }

  /**
   * send data to client
   *
   * @param {String} name
   * @param {???} data - any data type can be sent
   */
  _emit(name, data) {
    this._socket.emit(name, data);
  }

  /**
   * output to console
   *
   * @param {string} message - message to display
   */
  _print(message) {
    console.log(new Date().toLocaleString() + ':   ' + message);
  }

  /**
   * preform a ping test to a given url / address
   *
   * @param {String} url - url / ip to ping
   */
  _ping(url) {
    return new Promise(resolve => {
      let _ping = new this.PingWrapper(url);
      _ping.on('ping', data => resolve({
        address: url,
        data: data
      }));
      _ping.on('fail', data => resolve({
        address: url,
        data: false
      }));
      setTimeout(_ => _ping.stop(), 8000);
    });
  }

  /**
   * will kill power to the router by triggering a relay
   */
  _relayReboot() {
    return new Promise(resolve => {
      const _gpio = this.onoff(this.config.relayPin, 'out');
      _gpio.write(1, _ => {
        setTimeout(_ => {
          this._emit('toast', 'powering on router...');
          _gpio.write(0, _ => {
            this._print('router rebooted with relay');
            resolve();
          });
        }, 35000);
      });
    });
  }

  /**
   * log time and type of reboot
   *
   * @param {String} type - manual or automated
   * @param {String} user - username of the user the initated the reboot
   */
  _enterRestartToDB(type, user) {
    let obj = {
      time: new Date().getTime(),
      type: type
    };
    if (user) obj.user = user;
    this._restarts.insert(obj, err => this._pushRestarts(err));
  }


  _canSSH() {
    return (this.fs.existsSync(__dirname + '/ssh.json') && this._lastRouterPing.data.hasOwnProperty('time'));
  }

  /**
   * reboot the router
   *
   * @param {String} type - manual or automated
   * @param {String} user - username of the user the initated the reboot
   */
  _rebootRouter(type, user) {
    this._hasRebooted = true;
    this._emit('toast', 'rebooting router...');
    if (this._canSSH()) {
      // ssh file exist and last router ping was successful
      // will attempt to reboot with ssh

      const routerLogin = require(__dirname + '/ssh.json');
      if (!routerLogin.hasOwnProperty('host'))
        routerLogin.host = this._routerIP;
      try {
        console.log(routerLogin)
        const ssh = new this.SSH(routerLogin);
        ssh.on('error', err => {
          console.log(err)
          this._relayReboot().then(_ => this._enterRestartToDB(type, user));
          ssh.end();
        });
        ssh.exec(this.config.routerRebootCommand, {
          err: function (err) {
            console.log(err)
            this._relayReboot().then(_ => this._enterRestartToDB(type, user));
            ssh.end();
          },
          out: function (stdout)  {
            this._print('router rebooted with ssh connection');
            this._enterRestartToDB(type, user);
            ssh.end();
            console.log(stdout);
          },
          exit: function (code) {
            console.log(code);
          }
        }).start();
      } catch (e) {
        console.log(e)
        this._relayReboot().then(_ => this._enterRestartToDB(type, user));
      }
    } else if (!this._lastRouterPing.data.hasOwnProperty('time')) {
      // must be researt with relay
      this._relayReboot().then(_ => this._enterRestartToDB(type, user));
    } else {
      this._relayReboot().then(_ => this._enterRestartToDB(type, user));
    }
  }

  /**
   * count failed pings
   *
   * @param {Array} items - list of ping results
   */
  _countResults(items) {
    let count = 0;
    const total = items.length;
    let highPings = 0;
    for (let i = 0; i < total; i++) {
      if (!items[i].data) {
        count++;
        this._print('ping failed for ' + items[i].address);
      }
      if (items[i].data.hasOwnProperty('time') && items[i].data.time > this.config.maxPing) {
        highPings++;
        this._print(items[i].address + ' has ping greater then ' + this.config.maxPing);
      }
    }
    // all pings returned with good time
    if (!count && !highPings)
      this._print('all pings successful');
    // as long as even one ping is goood
    if (count > 1)
      this._hasRebooted = false;
    // notify front end of failed pings
    if (count)
      this._emit('toast', count + ' of ' + this._addresses.length + ' pings failed with ' + highPings + ' high pings');
    // all pings failed
    if (count === total && !this._hasRebooted)
      this._rebootRouter('automated');
    // half or more of the pings had high ping time
    if (highPings >= Math.floor(this._addresses.length / 2) && !this._hasRebooted)
      this._rebootRouter('automated');
    // output total time taken for pings to run to console
    console.timeEnd('all pings responded in');
    // update data on frontend
    this._pushHistory();
  }

  /**
   * update restarts on client
   *
   * @param {Error} err
   */
  _pushRestarts(err) {
    if (err) this._print(err);
    this._restarts.count({}, (err, count) => {
      this._restarts.find().sort({time: 1}).skip((_ => {
        if (count > 10) {
          return count - 10;
        } else {
          return 0;
        }
      })()).exec((err, logs) => this._emit('restarts', logs));
    });
  }

  /**
   * update history on client
   *
   * @param {Error} err
   */
  _pushHistory(err) {
    if (err) this._print(err);
    let expected = this.config.graphLength * this._addresses.length;
    this._history.count({}, (err, count) => {
      const skip = (_ => {
        if (count > expected) {
          return count - expected;
        } else {
          return 0;
        }
      })();
      this._history.find({})
      .skip(skip)
      .limit(expected)
      .exec((err, logs) =>
        this._emit('history', logs));
    });
  }

  /**
   * Promise that returns a response object with
   * the number of ping data points for the given host
   *
   * @param {String} host
   */
  _count(host) {
    return new Promise(resolve => {
      if (!this._isValidHost(host)) {
        resolve({
          status: 401,
          host: host,
          error: 'invalid host'
        });
        return;
      }
      this._history.count({
        address: host
      }, (err, count) => {
        if (err) {
          resolve({
            status: 500,
            host: host,
            error: err
          });
          return;
        }
        resolve({
          status: 200,
          host: host,
          count: count
        });
      });
    });
  }

  /**
   * Promise that resolves a response object with ping logs
   * from a given host with the provided limit & offset
   *
   * @param {String} host
   * @param {Number} skip - offset
   * @param {Number} limit
   */
  _getLogs(host, skip, limit) {
    return new Promise(resolve => {
      if (!this._isValidHost(host)) {
        resolve({
          status: 401,
          error: 'invalid host',
          host: host
        });
        return;
      }
      this._history.find({
        address: host
      }).skip(skip).limit(limit).exec((err, logs) => {
        if (err) {
          resolve({
            status: 500,
            error: err,
            host: host
          });
          return;
        }
        resolve({
          status: 200,
          history: logs,
          host: host
        })
      });
    });
  }

  /**
   * ging the given router ip every 30 seconds
   *
   * @param {String} - ip
   */
  _pingRouter(ip) {
    if (!this._routerIP)
      this._routerIP = ip;
    setTimeout(_ => {
      this._pingRouter(ip);
    }, 30000);
    this._ping(ip).then(res => {
      if (!res.data.hasOwnProperty('time')) {
        this._failedRouterPings++;
        if (this._failedRouterPings > 2)
          this._rebootRouter('automated');
        return;
      }
      this._lastRouterPing = res;
      this._failedRouterPings = 0;
      this._emit('router-status', res);
    });
  }

  /**
   * ping responded
   *
   * @param {object} data - ping response data
   */
  _response(data) {
    data.time = new Date().getTime();
    this._history.insert(data, err => {
      if (err) {
        throw new Error(err);
        return;
      }
    });
    this._responses.push(data);
    if (this._responses.length === this._addresses.length) this._countResults(this._responses);
  }

  /**
   * start the test
   */
  start() {
    const oneMin = 60000;
    const oneHour = oneMin * 60;
    // set the timer for next
    setTimeout(this.start.bind(this), oneHour * this.config.repeat);
    // clear responses array if it contains results
    if (this._responses.length) this._responses = [];
    this._print('running ping on ' + this._addresses.length + ' addresses');
    console.time('all pings responded in');
    // run ping on each address in the list
    this._addresses.forEach(address =>
      this._ping(address)
      .then(this._response.bind(this)));
    this._network.get_gateway_ip((err, ip) => this._pingRouter(ip));
  }

}

const configFile = require(__dirname + '/config.json');
const mongooseConfig = require(__dirname + '/mongoose.json');
const app = new Rebooter(configFile, mongooseConfig);
