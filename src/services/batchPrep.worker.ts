import { prepareBatchGeometry } from './batchPrepGeometry'

self.onmessage = (event: MessageEvent<Float32Array>) => {
  try {
    const result = prepareBatchGeometry(event.data)
    ;(self as unknown as Worker).postMessage(result, [result.bytes.buffer])
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
