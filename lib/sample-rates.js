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
