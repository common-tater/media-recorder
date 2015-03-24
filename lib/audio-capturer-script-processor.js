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
