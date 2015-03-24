var hyperglue = require('hyperglue2')
var getusermedia = require('getusermedia')
var context = require('audio-context')
var MediaRecorder = require('../')
var WAVEEncoder = require('../lib/audio-encoder-wav')
var computeAvailableSampleRates = require('../lib/sample-rates')

var SAMPLE_RATES = computeAvailableSampleRates(context.sampleRate)

function FormView () {
  this.el = document.querySelector('form')
  this.el.addEventListener('change', this._onchange.bind(this))

  var bitDepths = Object.keys(WAVEEncoder.BIT_DEPTHS).sort(numeric)
  var sampleRates = Object.keys(SAMPLE_RATES).sort(numeric)

  hyperglue(this.el, {
    '[name="bit-depth"] option': bitDepths.map(function (depth) {
      return {
        _text: depth,
        _attr: {
          value: depth
        }
      }
    }),
    '[name="sample-rate"] option': sampleRates.map(function (rate) {
      return {
        _text: rate,
        _attr: {
          value: rate
        }
      }
    })
  })
}

FormView.prototype._onchange = function () {
  var bd = parseInt(this.el['bit-depth'].value)
  var sr = parseFloat(this.el['sample-rate'].value)
  var m = this.el['mono'].value === '1'

  delay = this.el['delay']

  input.configure({
    audio: {
      capture: {
        mono: m
      },
      encode: {
        bitDepth: bd,
        sampleRate: sr
      }
    }
  })
}

function numeric (a, b) {
  return b - a
}

var input = null
var timer = null
var queue = []
var formview = new FormView()

getusermedia({ audio: true, video: false }, function (err, stream) {
  if (err) return console.error(err)

  input = new MediaRecorder(stream, 'audio/wav')

  input.configure({
    audio: {
      capture: {
        context: context
      },
      encode: {
        bitDepth: 32,
        sampleRate: context.sampleRate
      }
    }
  })

  input.ondataavailable = function (evt) {
    console.log(evt.data.byteLength)

    context.decodeAudioData(evt.data, function (buffer) {
      timer = timer || context.currentTime

      var source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.start(timer + 0.1)

      timer += buffer.duration
    })
  }

  input.start(1)
})
