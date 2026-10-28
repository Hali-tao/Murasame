import type { ActivityStatus, MurasameApi } from '@shared/types'

/** Events carry progress; serial health reads recover after load or missed events. */
export function followAutonomyStatus(
  api: Pick<MurasameApi['autonomy'], 'status' | 'onStatusChanged'>,
  receive: (state: ActivityStatus | null) => void
): () => void {
  let stopped = false
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribe = api.onStatusChanged?.(state => {
    if (stopped) return
    revision++
    receive(state)
  })
  const poll = async (): Promise<void> => {
    const startedAt = revision
    try {
      const state = await api.status()
      if (!stopped && startedAt === revision) receive(state)
    } catch {
      if (!stopped && startedAt === revision) receive(null)
    } finally {
      if (!stopped) timer = setTimeout(() => { void poll() }, 3000)
    }
  }
  void poll()
  return () => { stopped = true; clearTimeout(timer); unsubscribe?.() }
}
