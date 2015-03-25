# media-recorder
Yet another [MediaRecorder](http://www.w3.org/TR/mediastream-recording) shim. Only supports `audio/wav` for the moment, but makes some effort to be extensible.

## Why
Browser implementations for this API are inconsistent / incomplete.

## How
* [scriptProcessorNode](http://webaudio.github.io/web-audio-api/#the-scriptprocessornode-interface---deprecated)
* Totally non-standard "configure()" method

## Example
```javascript
var MediaRecorder = require('media-recorder')
var context = require('audio-context')

var r = new MediaRecorder(stream, 'audio/wav')

r.configure({
  audio: {
    capture: {
      context: context,
      mono: true
    },
    encode: {
      bitDepth: 16,
      sampleRate: context.sampleRate >> 1
    }
  },
  video: {
    // not yet
  }
})

r.ondataavailable = function (evt) {
  doSomethingCool(evt.data)
}

r.start(100)  // get data roughly every 100ms
```

## Credits
Hacked from:
* [Recorderjs](https://github.com/mattdiamond/Recorderjs)
* [node-wav](https://github.com/tootallnate/node-wav)

## License
MIT
