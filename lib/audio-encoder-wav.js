module.exports = WAVEEncoder

var bufferConcat = require('array-buffer-concat')
var computeAvailableSampleRates = require('./sample-rates')
var min = Math.min
var max = Math.max

var headerTemplate = makeHeaderTemplate()
var SAMPLE_RATES = null

WAVEEncoder.BIT_DEPTHS = {
  '8': 'setUint8',
  '16': 'setInt16',
  '32': 'setFloat32'
}

function WAVEEncoder () {}

WAVEEncoder.prototype.configure = function (opts) {
  this._bitDepth = opts && opts.bitDepth || this._bitDepth
  this._sampleRate = opts && opts.sampleRate || this._sampleRate

  if (!SAMPLE_RATES) {
    return
  }

  if (!SAMPLE_RATES[this._sampleRate]) {
    throw new TypeError('unsupported sample rate')
  }

  if (!WAVEEncoder.BIT_DEPTHS[this._bitDepth]) {
    throw new TypeError('unsupported bit depth')
  }

  this._skip = SAMPLE_RATES[this._sampleRate]
  this._writer = WAVEEncoder.BIT_DEPTHS[this._bitDepth]
  this._sampleMax = (2 << (this._bitDepth - 2)) - 1 >>> 0
  this._bytesPerSample = this._bitDepth / 8
  this._bytesPerBlock = this._bytesPerSample * this._channelCount
  this._byteRate = this._sampleRate * this._bytesPerBlock
  this._configured = true
}

WAVEEncoder.prototype.encode = function (audioBuffer, sampleRate, cb) {
  if (this._channelCount !== audioBuffer.numberOfChannels) {
    this._channelCount = audioBuffer.numberOfChannels
    this._configured = false
  }

  if (!SAMPLE_RATES) {
    SAMPLE_RATES = computeAvailableSampleRates(sampleRate)
    this._configured = false
  }

  if (!this._configured) {
    this.configure()
  }

  var channelCount = this._channelCount
  var channels = []

  for (var i = 0; i < channelCount; i++) {
    channels.push(audioBuffer.getChannelData(i))
  }

  var firstChannel = channels[0]
  var skip = this._skip
  var writer = this._writer
  var sampleMax = this._sampleMax
  var channelCount = this._channelCount
  var bytesPerSample = this._bytesPerSample
  var outputBuffer = new ArrayBuffer(bytesPerSample * channelCount * (firstChannel.length / skip))
  var outputView = new DataView(outputBuffer, 0)
  var o = 0

  for (var i = 0; i < firstChannel.length; i += skip) {
    for (var c = 0; c < channelCount; c++) {
      var input = channels[c]
      var sample = input[i]

      switch (bytesPerSample) {
        case 1: // 8 bit
          sample = 128 + ~~(sample * sampleMax)
          sample = min(sample, sampleMax << 2)
          sample = max(sample, 0)
          outputView[writer](o, sample)
          break
        case 2: // 16 bit
          sample = ~~(sample * sampleMax)
          sample = min(sample, sampleMax)
          sample = max(sample, -sampleMax)
          outputView[writer](o, sample, true)
          break
        case 4: // 32 bit
          outputView[writer](o, sample, true)
      }

      o += bytesPerSample
    }
  }

  cb(null, outputBuffer)
}

WAVEEncoder.prototype.wrap = function (data) {
  var header = headerTemplate.slice()
  var view = new DataView(header, 0)

  // set format type to WAVE_FORMAT_IEEE_FLOAT (3) for 32 bit samples
  if (this._bitDepth === 32) {
    view.setUint32(12, 3, true)
  }

  // indicate # of channels
  view.setUint16(14, this._channelCount, true)

  // samples per second
  view.setUint32(16, this._sampleRate, true)

  // bytes per second
  view.setUint32(20, this._byteRate, true)

  // bytes per block - each block contains one sample for each channel
  view.setUint16(24, this._bytesPerBlock, true)

  // bit depth per sample
  view.setUint16(26, this._bitDepth, true)

  // timestamp
  view.setFloat64(36, Date.now(), true)

  // data size
  view.setUint32(48, data.byteLength, true)

  return bufferConcat(header, data)
}

function makeHeaderTemplate () {
  var header = new ArrayBuffer(52)
  var view = new DataView(header, 0)
  var offset = 0

  // WAVE-ck
  for (var i = 0; i < 4; i++) {
    view.setUint8(offset + i, 'WAVE'.charCodeAt(i))
  }

  // fmt-ck
  offset = 4
  for (var i = 0; i < 4; i++) {
    view.setUint8(offset + i, 'fmt '.charCodeAt(i))
  }

  // bytes per fmt-ck
  view.setUint32(8, 16, true)

  // mode
  view.setUint32(12, 1, true)

  // time-ck
  offset = 28
  for (var i = 0; i < 4; i++) {
    view.setUint8(offset + i, 'time'.charCodeAt(i))
  }

  // bytes per time-ck
  view.setUint32(32, 8, true)

  // WAVE data
  offset = 44
  for (var i = 0; i < 4; i++) {
    view.setUint8(offset + i, 'data'.charCodeAt(i))
  }

  return header
}
