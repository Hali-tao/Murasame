export interface RuntimeStep {
  id: string
  evidence: string
  role?: string
  time?: string
}

export function compactContext(goal: string, steps: readonly RuntimeStep[], recentCount = 6): { goal: string; recent: RuntimeStep[]; summary: string } {
  const recent = steps.slice(-recentCount)
  const older = steps.slice(0, Math.max(0, steps.length - recentCount))
  // Extract complete source sentences throughout history, with priority for
  // facts, constraints, corrections and query matches. Never keep only a prefix.
  const queryTerms = goal.match(/[\p{L}\p{N}]{2,}/gu) ?? []
  const candidates = older.flatMap((step, index) => (step.evidence.match(/[^。！？!?\n]+[。！？!?]?/g) ?? []).map((sentence, part) => ({
    step, index, part, sentence,
    score: (/约定|代号|名字|叫我|偏好|喜欢|不吃|过敏|必须|不得|不要|禁止|限制|更正|改为|改成|废弃|目标|尚未|待办|计划|决定|项目/.test(sentence) ? 8 : 0)
      + (step.role === 'user' ? 2 : 0)
      + (queryTerms.some((term) => sentence.includes(term)) ? 4 : 0)
  })))
  const selected: typeof candidates = []
  let budget = 12000
  for (const item of [...candidates].sort((a, b) => b.score - a.score || b.index - a.index || a.part - b.part)) {
    const cost = item.sentence.length + item.step.id.length + 50
    if (cost > budget) continue
    selected.push(item)
    budget -= cost
  }
  const summary = selected.sort((a, b) => a.index - b.index || a.part - b.part)
    .map(({ step, sentence }) => `[${step.id}${step.role ? ` ${step.role}` : ''}${step.time ? ` ${step.time}` : ''}] ${sentence}`).join('\n')
  const omitted = candidates.length - selected.length
  return {
    goal,
    recent,
    summary: summary + (omitted ? `\n（更早记录摘录省略${omitted}句；未列出的内容不能视为不存在，可搜索原始历史核实。）` : '')
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
