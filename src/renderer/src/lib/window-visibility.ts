/** Native hiding does not unmount React. Keep the browser fallback for minimize
 * and invalidate in-flight recording requests before their late results arrive. */
export function onWindowHidden(cancelInput: () => void): () => void {
  const unsubscribe = window.murasame?.window?.onHidden?.(cancelInput)
  const checkVisibility = (): void => { if (document.hidden) cancelInput() }
  document.addEventListener('visibilitychange', checkVisibility)
  checkVisibility()
  return () => {
    unsubscribe?.()
    document.removeEventListener('visibilitychange', checkVisibility)
  }
}
