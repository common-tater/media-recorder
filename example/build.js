(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

},{"../":2,"../lib/audio-encoder-wav":4,"../lib/sample-rates":6,"audio-context":8,"getusermedia":11,"hyperglue2":12}],2:[function(require,module,exports){
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

},{"./lib/audio-capturer-script-processor":3,"./lib/audio-encoder-wav":4,"./lib/data-container-riff":5,"array-buffer-concat":7,"events":10,"inherits":14,"merge":15}],3:[function(require,module,exports){
module.exports = ScriptProcessorCapturer

function ScriptProcessorCapturer (stream) {
  this._stream = stream
  this._session = 0
}

ScriptProcessorCapturer.prototype.configure = function (opts) {
  this._context = this._context || opts.context
  this._mono = opts.mono

  if (this._processor) {
    this.stop()
    this.start()
  }
}

ScriptProcessorCapturer.prototype.start = function () {
  this._source = this._context.createMediaStreamSource(this._stream)
  this._channelCount = this._mono ? 1 : this._source.channelCount
  this._processor = this._context.createScriptProcessor(undefined, this._channelCount, this._channelCount)
  this._processor.onaudioprocess = oncapture.bind(this, this._session)
  this._processor.connect(this._context.destination)
  this.resume()
}

ScriptProcessorCapturer.prototype.stop = function () {
  this._session++
  this._source.disconnect(this._processor)
  this._processor.disconnect(this._context.destination)
  this._processor = null
}

ScriptProcessorCapturer.prototype.pause = function () {
  this._source.disconnect(this._processor)
}

ScriptProcessorCapturer.prototype.resume = function () {
  this._source.connect(this._processor)
}

function oncapture (session, samples) {
  if (this._session === session) {
    this.oncapture(samples.inputBuffer, this._context.sampleRate)
  }
}

},{}],4:[function(require,module,exports){
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

  // data size
  view.setUint32(32, data.byteLength, true)

  return bufferConcat(header, data)
}

function makeHeaderTemplate () {
  var header = new ArrayBuffer(36)
  var view = new DataView(header, 0)
  var offset = 0

  for (var i = 0; i < 4; i++) {
    view.setUint8(offset + i, 'WAVE'.charCodeAt(i))
  }

  offset = 4
  for (var i = 0; i < 4; i++) {
    view.setUint8(offset + i, 'fmt '.charCodeAt(i))
  }

  // bytes per header
  view.setUint32(8, 16, true)

  // mode
  view.setUint32(12, 1, true)

  offset = 28
  for (var i = 0; i < 4; i++) {
    view.setUint8(offset + i, 'data'.charCodeAt(i))
  }

  return header
}

},{"./sample-rates":6,"array-buffer-concat":7}],5:[function(require,module,exports){
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

},{"array-buffer-concat":7}],6:[function(require,module,exports){
module.exports = computeAvailableSampleRates

function computeAvailableSampleRates (max) {
  var chunkSize = 256
  var min = 8000
  var rate = max
  var factor = 1
  var sampleRates = {}

  while (1) {
    while (chunkSize % factor) factor++
    rate = max / factor
    if (rate < min) break
    sampleRates[rate] = factor++
  }

  return sampleRates
}

},{}],7:[function(require,module,exports){
module.exports = arrayBufferConcat

function arrayBufferConcat () {
  var length = 0
  var buffer = null

  for (var i in arguments) {
    buffer = arguments[i]
    length += buffer.byteLength
  }

  var joined = new Uint8Array(length)
  var offset = 0

  for (var i in arguments) {
    buffer = arguments[i]
    joined.set(new Uint8Array(buffer), offset)
    offset += buffer.byteLength
  }

  return joined.buffer
}

},{}],8:[function(require,module,exports){
var window = require('global/window');

var Context = window.AudioContext || window.webkitAudioContext;
if (Context) module.exports = new Context;

},{"global/window":9}],9:[function(require,module,exports){
(function (global){
if (typeof window !== "undefined") {
    module.exports = window;
} else if (typeof global !== "undefined") {
    module.exports = global;
} else {
    module.exports = {};
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],10:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],11:[function(require,module,exports){
// getUserMedia helper by @HenrikJoreteg
var func = (window.navigator.getUserMedia ||
            window.navigator.webkitGetUserMedia ||
            window.navigator.mozGetUserMedia ||
            window.navigator.msGetUserMedia);


module.exports = function (constraints, cb) {
    var options, error;
    var haveOpts = arguments.length === 2;
    var defaultOpts = {video: true, audio: true};
    var denied = 'PermissionDeniedError';
    var notSatisfied = 'ConstraintNotSatisfiedError';

    // make constraints optional
    if (!haveOpts) {
        cb = constraints;
        constraints = defaultOpts;
    }

    // treat lack of browser support like an error
    if (!func) {
        // throw proper error per spec
        error = new Error('MediaStreamError');
        error.name = 'NotSupportedError';

        // keep all callbacks async
        return window.setTimeout(function () {
            cb(error);
        }, 0);
    }

    // make requesting media from non-http sources trigger an error
    // current browsers silently drop the request instead
    var protocol = window.location.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
        error = new Error('MediaStreamError');
        error.name = 'NotSupportedError';

        // keep all callbacks async
        return window.setTimeout(function () {
            cb(error);
        }, 0);
    }

    // normalize error handling when no media types are requested
    if (!constraints.audio && !constraints.video) {
        error = new Error('MediaStreamError');
        error.name = 'NoMediaRequestedError';

        // keep all callbacks async
        return window.setTimeout(function () {
            cb(error);
        }, 0);
    }

    if (localStorage && localStorage.useFirefoxFakeDevice === "true") {
        constraints.fake = true;
    }

    func.call(window.navigator, constraints, function (stream) {
        cb(null, stream);
    }, function (err) {
        var error;
        // coerce into an error object since FF gives us a string
        // there are only two valid names according to the spec
        // we coerce all non-denied to "constraint not satisfied".
        if (typeof err === 'string') {
            error = new Error('MediaStreamError');
            if (err === denied) {
                error.name = denied;
            } else {
                error.name = notSatisfied;
            }
        } else {
            // if we get an error object make sure '.name' property is set
            // according to spec: http://dev.w3.org/2011/webrtc/editor/getusermedia.html#navigatorusermediaerror-and-navigatorusermediaerrorcallback
            error = err;
            if (!error.name) {
                // this is likely chrome which
                // sets a property called "ERROR_DENIED" on the error object
                // if so we make sure to set a name
                if (error[denied]) {
                    err.name = denied;
                } else {
                    err.name = notSatisfied;
                }
            }
        }

        cb(error);
    });
};

},{}],12:[function(require,module,exports){
var domify = require('domify');

module.exports = hyperglue;

function hyperglue(el, data, opts) {
  if (!opts) opts = {};

  // if 'el' is an html string, turn it into dom elements
  if (typeof el === 'string') {
    el = domify(el);
  }

  // boundaries must be collected at the highest level possible
  if (opts.boundary && typeof opts.boundary !== 'object') {
    opts.boundary = el.querySelectorAll(opts.boundary);
  }

  // no data so we're done
  if (data === undefined) return el;

  // null should remove textContent
  if (data === null) data = '';

  // if data is an HTML element just replace whatever was there with it
  if (data instanceof Element) {
    while (el.childNodes.length) {
      el.removeChild(el.firstChild);
    }
    el.appendChild(data);
  }

  // elsewise assume other object types are hashes
  else if (typeof data === 'object') {
    for (var selector in data) {
      var value = data[selector];

      // plain text
      if (selector === '_text') {
        el.textContent = value;
      }

      // raw html
      else if (selector === '_html') {
        el.innerHTML = value;
      }

      // dom element
      else if (selector === '_element') {
        while (el.childNodes.length) {
          el.removeChild(el.firstChild);
        }
        el.appendChild(value);
      }

      // attribute setting
      else if (selector === '_attr') {
        for (var attr in value) {
          var val = value[attr];
          if (val === null || 
              val === undefined) {
            el.removeAttribute(attr);
          }
          else {
            el.setAttribute(attr, value[attr]);
          }
        }
      }

      // recursive
      else {

        // arrays need some extra setup so that they can be rendered
        // multiple times without disturbing neighboring elements
        var isArray = Array.isArray(value);
        var needsCache = false;
        var matches = null;
        if (isArray) {
          el._hyperglueArrays = el._hyperglueArrays || {};
          matches = el._hyperglueArrays[selector];
          if (!matches) {
            el._hyperglueArrays[selector] = [];
            needsCache = true;
          }
        }

        matches = matches || el.querySelectorAll(selector);
        for (var i=0; i<matches.length; i++) {
          var match = matches[i];

          // make sure match is not beyond a boundary
          if (opts.boundary) {
            var withinBoundary = true;
            for (var n=0; n<opts.boundary.length; n++) {
              if (opts.boundary[n].contains(match)) {
                withinBoundary = false;
                break;
              }
            }
            if (!withinBoundary) continue;
          }

          // render arrays
          if (isArray) {

            // in case the template contained multiple rows (we only use the first one)
            if (!match.parentNode) continue;

            // cache blueprint node
            if (needsCache && needsCache !== match.parent) {
              needsCache = match.parentNode;
              el._hyperglueArrays[selector].push({
                node: match.cloneNode(true),
                parentNode: match.parentNode,
                cloneNode: function() {
                  return this.node.cloneNode(true);
                }
              });
            }

            // remove any existing rows
            var parent = match.parentNode;
            while (parent.childNodes.length) {
              parent.removeChild(parent.childNodes[0]);
            }

            // render new rows
            for (var n in value) {
              var item = value[n];
              parent.appendChild(hyperglue(match.cloneNode(true), item));
            }
          }

          // render non-arrays
          else {
            hyperglue(match, value);
          }
        }
      }
    }
  }
  else {
    el.textContent = data;
  }

  return el;
};

},{"domify":13}],13:[function(require,module,exports){

/**
 * Expose `parse`.
 */

module.exports = parse;

/**
 * Tests for browser support.
 */

var div = document.createElement('div');
// Setup
div.innerHTML = '  <link/><table></table><a href="/a">a</a><input type="checkbox"/>';
// Make sure that link elements get serialized correctly by innerHTML
// This requires a wrapper element in IE
var innerHTMLBug = !div.getElementsByTagName('link').length;
div = undefined;

/**
 * Wrap map from jquery.
 */

var map = {
  legend: [1, '<fieldset>', '</fieldset>'],
  tr: [2, '<table><tbody>', '</tbody></table>'],
  col: [2, '<table><tbody></tbody><colgroup>', '</colgroup></table>'],
  // for script/link/style tags to work in IE6-8, you have to wrap
  // in a div with a non-whitespace character in front, ha!
  _default: innerHTMLBug ? [1, 'X<div>', '</div>'] : [0, '', '']
};

map.td =
map.th = [3, '<table><tbody><tr>', '</tr></tbody></table>'];

map.option =
map.optgroup = [1, '<select multiple="multiple">', '</select>'];

map.thead =
map.tbody =
map.colgroup =
map.caption =
map.tfoot = [1, '<table>', '</table>'];

map.polyline =
map.ellipse =
map.polygon =
map.circle =
map.text =
map.line =
map.path =
map.rect =
map.g = [1, '<svg xmlns="http://www.w3.org/2000/svg" version="1.1">','</svg>'];

/**
 * Parse `html` and return a DOM Node instance, which could be a TextNode,
 * HTML DOM Node of some kind (<div> for example), or a DocumentFragment
 * instance, depending on the contents of the `html` string.
 *
 * @param {String} html - HTML string to "domify"
 * @param {Document} doc - The `document` instance to create the Node for
 * @return {DOMNode} the TextNode, DOM Node, or DocumentFragment instance
 * @api private
 */

function parse(html, doc) {
  if ('string' != typeof html) throw new TypeError('String expected');

  // default to the global `document` object
  if (!doc) doc = document;

  // tag name
  var m = /<([\w:]+)/.exec(html);
  if (!m) return doc.createTextNode(html);

  html = html.replace(/^\s+|\s+$/g, ''); // Remove leading/trailing whitespace

  var tag = m[1];

  // body support
  if (tag == 'body') {
    var el = doc.createElement('html');
    el.innerHTML = html;
    return el.removeChild(el.lastChild);
  }

  // wrap map
  var wrap = map[tag] || map._default;
  var depth = wrap[0];
  var prefix = wrap[1];
  var suffix = wrap[2];
  var el = doc.createElement('div');
  el.innerHTML = prefix + html + suffix;
  while (depth--) el = el.lastChild;

  // one element
  if (el.firstChild == el.lastChild) {
    return el.removeChild(el.firstChild);
  }

  // several elements
  var fragment = doc.createDocumentFragment();
  while (el.firstChild) {
    fragment.appendChild(el.removeChild(el.firstChild));
  }

  return fragment;
}

},{}],14:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],15:[function(require,module,exports){
/*!
 * @name JavaScript/NodeJS Merge v1.2.0
 * @author yeikos
 * @repository https://github.com/yeikos/js.merge

 * Copyright 2014 yeikos - MIT license
 * https://raw.github.com/yeikos/js.merge/master/LICENSE
 */

;(function(isNode) {

	/**
	 * Merge one or more objects 
	 * @param bool? clone
	 * @param mixed,... arguments
	 * @return object
	 */

	var Public = function(clone) {

		return merge(clone === true, false, arguments);

	}, publicName = 'merge';

	/**
	 * Merge two or more objects recursively 
	 * @param bool? clone
	 * @param mixed,... arguments
	 * @return object
	 */

	Public.recursive = function(clone) {

		return merge(clone === true, true, arguments);

	};

	/**
	 * Clone the input removing any reference
	 * @param mixed input
	 * @return mixed
	 */

	Public.clone = function(input) {

		var output = input,
			type = typeOf(input),
			index, size;

		if (type === 'array') {

			output = [];
			size = input.length;

			for (index=0;index<size;++index)

				output[index] = Public.clone(input[index]);

		} else if (type === 'object') {

			output = {};

			for (index in input)

				output[index] = Public.clone(input[index]);

		}

		return output;

	};

	/**
	 * Merge two objects recursively
	 * @param mixed input
	 * @param mixed extend
	 * @return mixed
	 */

	function merge_recursive(base, extend) {

		if (typeOf(base) !== 'object')

			return extend;

		for (var key in extend) {

			if (typeOf(base[key]) === 'object' && typeOf(extend[key]) === 'object') {

				base[key] = merge_recursive(base[key], extend[key]);

			} else {

				base[key] = extend[key];

			}

		}

		return base;

	}

	/**
	 * Merge two or more objects
	 * @param bool clone
	 * @param bool recursive
	 * @param array argv
	 * @return object
	 */

	function merge(clone, recursive, argv) {

		var result = argv[0],
			size = argv.length;

		if (clone || typeOf(result) !== 'object')

			result = {};

		for (var index=0;index<size;++index) {

			var item = argv[index],

				type = typeOf(item);

			if (type !== 'object') continue;

			for (var key in item) {

				var sitem = clone ? Public.clone(item[key]) : item[key];

				if (recursive) {

					result[key] = merge_recursive(result[key], sitem);

				} else {

					result[key] = sitem;

				}

			}

		}

		return result;

	}

	/**
	 * Get type of variable
	 * @param mixed input
	 * @return string
	 *
	 * @see http://jsperf.com/typeofvar
	 */

	function typeOf(input) {

		return ({}).toString.call(input).slice(8, -1).toLowerCase();

	}

	if (isNode) {

		module.exports = Public;

	} else {

		window[publicName] = Public;

	}

})(typeof module === 'object' && module && typeof module.exports === 'object' && module.exports);
},{}]},{},[1]);
