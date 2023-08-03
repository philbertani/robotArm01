const path = require('path');

console.log(path.resolve(__dirname))

module.exports = {
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'public'),
    filename: 'bundle.js'
  }
}
