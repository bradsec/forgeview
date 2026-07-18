/**
 * Resolve after the browser has had a chance to paint. Used before large
 * synchronous work (model parsing, export serialization) so a just-updated
 * progress label actually reaches the screen first. Double rAF: the first
 * fires before paint, the second after it.
 */
export function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}
