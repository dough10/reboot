(function () {
  'use strict';

  var appData = {};

  /**
   * set the opacity of a give element to a give value
   *
   * @param {Element} el = the element to edit opacity of
   * @param {Number} opacity = the value to set opacity to
   */
  function setOpacity(el, opacity) {
    el.style.opacity = opacity;
  }

  /**
   * fade in opacity of a given element
   *
   * @param {HTMLElement} el
   */
  function fadeIn(el) {
    var opacity = 0;
    requestAnimationFrame(function step(timeStamp) {
      opacity += 0.05;
      if (opacity >= 1) {
        var event = new CustomEvent('faded', {
          detail: {
            element: el,
            direction: 'in'
          }
        });
        el.dispatchEvent(event);
        setOpacity(el, 1);
        return;
      }
      setOpacity(el, opacity);
      requestAnimationFrame(step);
    });
  }

  /**
   * sort the history object into appData object
   *
   * @param {array} history
   */
  function sortHistory(history) {
    return new Promise(function (resolve) {
      var obj = {};
      history.forEach(function (entry) {
        if (obj.hasOwnProperty(entry.address)) {
          obj[entry.address].push(entry);
        } else {
          obj[entry.address] = [];
          obj[entry.address].push(entry);
        }
      });
      resolve(obj);
    });
  }

  /**
   * return a array of ping entry times
   *
   * @param {Array} array
   */
  function returnTime(array) {
    var output = [];
    var len = array.length;
    for (var i = 0; i < len; i++) {
      output.push(new Date(array[i].time).toLocaleTimeString());
    }
    return output;
  }

  /**
   * return a array of ping entry data
   *
   * @param {Array} array
   */
  function returnData(array) {
    var output = [];
    var len = array.length;

    var _loop = function (i) {
      output.push(function () {
        if (array[i].data) {
          return array[i].data.time;
        } else {
          return 0;
        }
      }());
    };

    for (var i = 0; i < len; i++) {
      _loop(i);
    }
    return output;
  }

  /**
   * render graphs of the input data
   *
   * @param {Object} data
   */
  function graphData(data) {
    var card = document.querySelector('#card');
    var width = card.offsetWidth - 48;
    for (var key in data) {
      var id = 'el-' + key.replace(/\./g, '');
      var exist = document.querySelector('#' + id);
      if (exist) card.removeChild(exist);
      var div = document.createElement('div');
      var text = document.createElement('h3');
      div.id = id;
      div.style.opacity = 0;
      text.textContent = key;
      div.appendChild(text);
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = 200;
      div.appendChild(canvas);
      card.appendChild(div);
      var r = Math.floor(Math.random() * 256);
      var g = Math.floor(Math.random() * 256);
      var b = Math.floor(Math.random() * 256);
      var light = 'rgba(' + r + ',' + g + ',' + b + ', 0.1)';
      var dark = 'rgba(' + r + ',' + g + ',' + b + ', 1)';
      var chartData = {
        labels: returnTime(data[key]),
        datasets: [{
          label: key + " Ping",
          fillColor: light,
          strokeColor: dark,
          data: returnData(data[key])
        }]
      };
      var ctx = canvas.getContext("2d");
      var chart = new Chart(ctx).Line(chartData, {
        animation: false,
        pointDot: false,
        showTooltips: true,
        scaleLabel: "<%=value%> ms",
        scaleFontFamily: "'Roboto', 'Noto', sans-serif",
        scaleFontSize: 10
      });
      fadeIn(div);
    }
  }

  function outputRestarts(logs) {
    if (logs.length) {
      var last = document.querySelector('#lastRestart');
      last.textContent = new Date(logs[logs.length - 1].time).toLocaleString();
    }
  }

  // redraw graphs on window reload
  var timer = 0;
  window.onresize = function () {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    timer = setTimeout(function () {
      graphData(appData);
      timer = 0;
    }, 100);
  };

  // run the app
  window.onload = function () {
    var card = document.querySelector('#card');
    fadeIn(card);
    // socket.io setup
    var socket = io.connect(location.origin);
    socket.on('history', function (logs) {
      return sortHistory(logs).then(function (data) {
        appData = data;
        graphData(data);
      });
    });
    socket.on('restarts', function (logs) {
      return outputRestarts(logs);
    });
  };
})();
//# sourceMappingURL=app.js.map
