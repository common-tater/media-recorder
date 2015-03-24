module.exports = MediaRecorder

var inherits = require('inherits')
var events = require('events')
var merge = require('merge').recursive
var bufferConcat = require('array-buffer-concat')

var capturers = {
  audio: {
    'scriptProcessor': require('./lib/audio-capturer-script-processor')
  },
  video: {}
}

var encoders = {
  audio: {
    'wav': require('./lib/audio-encoder-wav')
  },
  video: {}
}

var containers = {
  'riff': require('./lib/data-container-riff')
}

var mimeTypes = {
  'audio/wav': true
}

var defaultConfig = {
  audio: {
    capture: {
      type: 'scriptProcessor'
    },
    encode: {
      type: 'wav'
    }
  },
  video: {
    capture: {},
    encode: {}
  },
  container: {
    type: 'riff'
  }
}

inherits(MediaRecorder, events.EventEmitter)

function MediaRecorder (stream, mimeType) {
  if (!stream) {
    throw new TypeError('not enough arguments to MediaRecorder')
  }

  this._state = 'inactive'
  this._stream = stream
  this._capturers = {}
  this._encoders = {}
  this._config = merge(true, defaultConfig)

  var tracks = stream.getTracks()
  this._trackTypes = {}

  for (var i in tracks) {
    this._trackTypes[tracks[i].kind] = true
  }

  if (Object.keys(this._trackTypes).length === 0) {
    throw new TypeError('no tracks to record')
  }

  if (mimeType) {
    var type = mimeType.split('/')[0]
    if (!this._trackTypes[type]) {
      throw new TypeError('no tracks with the desired media type to record')
    }

    // special case - if the user specified an audio mimeType, make sure to ignore video
    if (type === 'audio') {
      delete this._trackTypes.video
    }
  } else {
    // try to guess how to record
    if (this._trackTypes.video) {
      this._mimeType = 'video/ogg'
    } else if (this._trackTypes.audio) {
      this._mimeType = 'audio/wav'
    }
  }

  if (!mimeTypes[mimeType]) {
    throw new TypeError('unsupported mimeType')
  }

  events.EventEmitter.call(this)
}

MediaRecorder.prototype.addEventListener = function () {
  this.addListener.apply(this, arguments)
}

MediaRecorder.prototype.removeEventListener = function () {
  this.removeListener.apply(this, arguments)
}

Object.defineProperty(MediaRecorder.prototype, 'stream', {
  get: function () {
    return this._stream
  }
})

Object.defineProperty(MediaRecorder.prototype, 'mimeType', {
  get: function () {
    return this._mimeType
  }
})

Object.defineProperty(MediaRecorder.prototype, 'state', {
  get: function () {
    return this._state
  }
})

MediaRecorder.prototype.configure = function (opts) {
  merge(this._config, opts)

  for (var type in this._trackTypes) {
    var capturer = this._capturers[type]
    var encoder = this._encoders[type]

    capturer && capturer.configure(this._config[type].capture)
    encoder && encoder.configure(this._config[type].encode)
  }
}

MediaRecorder.prototype.start = function (timeSlice) {
  if (this._state !== 'inactive') throw new MediaError('InvalidState')

  this._timeSlice = timeSlice
  this._startTime = Date.now()

  for (var type in this._trackTypes) {
    this._start(type)
  }

  this.configure()

  this._state = 'recording'
  var evt = new Event('start')
  this.onstart && this.onstart(evt)
  this.emit('start', evt)
}

MediaRecorder.prototype.stop = function () {
  if (this._state === 'inactive') throw new MediaError('InvalidState')

  for (var type in this._trackTypes) {
    this._stop(type)
  }

  this._emitDataAvailable.call(this)

  this._state = 'inactive'
  var evt = new Event('stop')
  this.onstop && this.onstop(evt)
  this.emit('stop', evt)
}

MediaRecorder.prototype.pause = function () {
  if (this._state === 'inactive') throw new MediaError('InvalidState')

  for (var type in capturers) {
    if (this._capturers[type]) {
      this._capturers[type].pause()
    }
  }

  this._state = 'paused'
  var evt = new Event('pause')
  this.onpause && this.onpause(evt)
  this.emit('pause', evt)
}

MediaRecorder.prototype.resume = function () {
  if (this._state === 'inactive') throw new MediaError('InvalidState')

  for (var type in capturers) {
    if (this._capturers[type]) {
      this._capturers[type].resume()
    }
  }

  this._state = 'recording'
  var evt = new Event('resume')
  this.onresume && this.onresume(evt)
  this.emit('resume', evt)
}

MediaRecorder.prototype.requestData = function () {
  if (this._state !== 'recording') throw new MediaError('InvalidState')

  this._dataRequested = true
}

MediaRecorder.prototype.canRecordMimeType = function (mimeType) {
  switch (mimeType) {
    case 'audio/wav':
      return 'probably'
    default:
      return ''
  }
}

MediaRecorder.prototype._start = function (mediaType) {
  Capturer = capturers[mediaType][this._config[mediaType].capture.type]
  Encoder = encoders[mediaType][this._config[mediaType].encode.type]

  this._capturers[mediaType] = new Capturer(this._stream)
  this._encoders[mediaType] = new Encoder()

  this._oncapture = oncapture.bind(this, mediaType)
  this._capturers[mediaType].oncapture = this._oncapture

  var self = this
  setTimeout(function () {
    self._capturers[mediaType].start()
  })
}

MediaRecorder.prototype._stop = function (mediaType) {
  this._capturers[mediaType].oncapture = null
  this._capturers[mediaType].stop()

  delete this._capturers[mediaType]
  delete this._encoders[mediaType]
}

function oncapture (mediaType, samples, sampleRate) {
  var self = this

  this._encoders[mediaType].encode(samples, sampleRate, function (err, data) {
    if (err) throw err

    self._buffers = self._buffers || {}
    var buffer = self._buffers[mediaType]

    if (buffer) {
      self._buffers[mediaType] = bufferConcat(buffer, data)
    } else {
      self._buffers[mediaType] = data
    }

    var now = Date.now()
    if (self._timeSlice && now - self._startTime > self._timeSlice) {
      self._emitDataAvailable()
      self._startTime = now
    }
  })
}

MediaRecorder.prototype._emitDataAvailable = function () {
  var Container = containers[this._config.container.type]
  var container = new Container()
  container.config = this._config.container

  var data = {}

  for (var type in this._trackTypes) {
    data[type] = this._encoders[type].wrap(this._buffers[type])
  }

  data = container.wrap(data)
  delete this._buffers

  var evt = new Event('dataavailable')
  evt.data = data
  this.ondataavailable && this.ondataavailable(evt)
  this.emit('dataavailable', evt)
}
