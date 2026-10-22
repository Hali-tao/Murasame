export interface RuntimeStep {
  id: string
  evidence: string
}

export function compactContext(goal: string, steps: readonly RuntimeStep[], recentCount = 6): { goal: string; recent: RuntimeStep[]; summary: string } {
  const recent = steps.slice(-recentCount)
  const older = steps.slice(0, Math.max(0, steps.length - recentCount))
  return {
    goal,
    recent,
    summary: older.map((step) => step.evidence).join('；')
  }
}

export function shouldRetry(input: { networkError: boolean; hasSideEffect: boolean; outcomeKnown: boolean }): boolean {
  if (input.hasSideEffect && !input.outcomeKnown) return false
  return input.networkError && input.outcomeKnown
}

export class RequestQueue {
  private pending = Promise.resolve()
  private waiting = 0

  get waitingCount(): number {
    return this.waiting
  }

  enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.waiting += 1
    const run = this.pending.then(async () => {
      this.waiting -= 1
      return job()
    })
    this.pending = run.then(() => undefined, () => undefined)
    return run
  }
}

export function overBudget(used: number, limit: number): '继续' | '部分完成' {
  return used > limit ? '部分完成' : '继续'
}
