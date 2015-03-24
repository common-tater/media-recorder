# media-recorder
Yet another [MediaRecorder](http://www.w3.org/TR/mediastream-recording) shim. Only supports `audio/wav` for the moment, but makes some effort to be extensible.

## Why
Browser implementations for this API are inconsistent / incomplete.

## How
[scriptProcessorNode](http://webaudio.github.io/web-audio-api/#the-scriptprocessornode-interface---deprecated)

## Notes
An experiment for now. The spec is pretty far from ready, and I'm not convinced it makes sense. A general purpose media recorder would need to allow users to select what to record (audio, video or both), configure capture mechanisms, encoding mechanisms and container formats. It's a nice idea to minimize surface area, but this task may be too complicated to abstract in a useful way.

## Credits
Hacked from:
* [Recorderjs](https://github.com/mattdiamond/Recorderjs)
* [node-wav](https://github.com/tootallnate/node-wav)

## License
MIT
