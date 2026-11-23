// Cat voices from Runware. Off until a voice model is verified; the browser's
// own speech covers for it.
export const ttsReady = () => false
export function tts(url, res) {
  res.statusCode = 404
  res.end()
}
