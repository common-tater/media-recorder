module.exports = Container

var bufferConcat = require('array-buffer-concat')
var headerTemplate = makeHeaderTemplate()

function Container () {}

Container.prototype.wrap = function (data) {
  var header = headerTemplate.slice()
  var view = new DataView(header, 0)

  data = data.audio

  // RIFF file size
  view.setUint32(4, data.byteLength)

  return bufferConcat(header, data)
}

function makeHeaderTemplate () {
  var header = new ArrayBuffer(8)
  var view = new DataView(header, 0)
  var offset = 0

  for (var i = 0; i < 4; i++) {
    view.setUint8(i, 'RIFF'.charCodeAt(i))
  }

  return header
}
