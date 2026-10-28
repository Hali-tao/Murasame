import type { PetActivityMotion } from '@shared/pet-work'

type Play = (motion: PetActivityMotion | null, current: () => boolean, started: () => void) => Promise<void>

/** Native motion completion, rather than a wall-clock timer, releases responses. */
export class ActivityMotionDirector {
  private activity: PetActivityMotion | null = null
  private applied: string | null = null
  private responding = false
  private pendingResponse = false
  private pendingStart = false
  private version = 0
  private disposed = false

  constructor(private readonly play: Play, private readonly onError: (error: unknown) => void = () => undefined) {}

  get waitingForStart(): boolean { return this.pendingStart && !this.disposed }

  setActivity(activity: PetActivityMotion | null): void {
    if (this.disposed) return
    this.activity = activity
    if (!this.responding) this.apply()
  }

  transient(motion: string, expression: string | null): void {
    if (this.disposed) return
    this.responding = true
    this.applied = null
    this.dispatch({ key: 'response', motion, expression, loop: false }, true)
  }

  finished(): void {
    if (this.pendingResponse) return
    const version = this.version
    // Cubism completes its state and may reserve Idle after emitting motionFinish.
    // Resume only after that update, without playing a stale queued response.
    queueMicrotask(() => {
      if (this.disposed || this.version !== version) return
      if (!this.responding) return
      this.responding = false
      this.applied = null
      this.apply(true)
    })
  }

  dispose(): void { this.disposed = true; this.version++ }

  private apply(force = false): void {
    const key = this.activity ? `${this.activity.key}|${this.activity.motion}|${this.activity.expression}|${this.activity.loop}` : null
    if (!force && key === this.applied) return
    this.applied = key
    this.dispatch(this.activity, false)
  }

  private dispatch(motion: PetActivityMotion | null, response: boolean): void {
    const version = ++this.version
    const current = (): boolean => !this.disposed && this.version === version
    this.pendingResponse = response
    this.pendingStart = true
    void this.play(motion, current, () => { if (current()) { this.pendingResponse = false; this.pendingStart = false } }).catch(error => {
      if (!current()) return
      this.pendingStart = false
      this.onError(error)
      if (response) { this.responding = false; this.pendingResponse = false; this.applied = null; this.apply(true) }
    })
  }
}
