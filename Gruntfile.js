module.exports = function(grunt) {
  grunt.initConfig({
    processhtml: {
      build: {
        options: {
          strip: true,
          recursive: true
        },
        files: {
          'html/build.html':'html/src.html'
        }
      }
    },
    uglify: {
      build: {
        files: {
          'html/js/app.min.js': [
            'html/js/app.js',
            'html/js/Charts.min.js',
            'html/js/io.js'
          ]
        }
      }
    },
    babel: {
      options: {
        sourceMap: true,
        plugins: [
          "transform-es2015-arrow-functions",
          "transform-es2015-block-scoping"
        ]
      },
      build: {
        files: {
          "html/js/app.js": "html/js/app.es6"
        }
      }
    },
    cssmin: {
      options: {
        shorthandCompacting: false,
        roundingPrecision: -1
      },
      build: {
        files: {
          'html/css/app.min.css': [
            'html/css/base.css'
          ]
        }
      }
    },
    htmlmin: {
      build: {
        options: {
          removeComments: true,
          collapseWhitespace: true
        },
        files: {
          'html/index.html': 'html/build.html',
        }
      }
    }
  });
  grunt.loadNpmTasks('grunt-processhtml');
  grunt.loadNpmTasks('grunt-contrib-cssmin');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-htmlmin');
  grunt.loadNpmTasks('grunt-babel');
  grunt.registerTask('default', ['processhtml:build', 'babel:build', 'cssmin:build', 'uglify:build', 'htmlmin:build']);
};
