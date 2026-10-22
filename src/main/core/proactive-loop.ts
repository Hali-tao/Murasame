import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { powerMonitor, screen } from 'electron'
import { readForeground } from '../local/uia'
import { proactiveDecision } from './services/proactive-service'
import type { RelationshipStage } from './services/relationship-service'

export interface LoopDeps {
  hidden: () => boolean
  doNotDisturb: () => boolean
  taskRunning: () => boolean
  pace: () => 'low' | 'mid' | 'high'
  stage: () => RelationshipStage
  reasons: () => string[]
  say: (text: string) => void
}

const HOUR = 60 * 60 * 1000

export class ProactiveLoop {
  private timer: NodeJS.Timeout | null = null
  private lastSpokeAt = 0
  private spokenThisHour = 0
  private spokenToday = 0
  private hourStartedAt = Date.now()
  private dayStartedAt = Date.now()

  constructor(private readonly deps: LoopDeps) {}

  start(intervalMs = 5 * 60 * 1000): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** 有理由且不打扰才开口；两者是与的关系。 */
  tick(now = Date.now()): { spoke: boolean; reason: string } {
    if (now - this.hourStartedAt >= HOUR) {
      this.hourStartedAt = now
      this.spokenThisHour = 0
    }
    if (now - this.dayStartedAt >= 24 * HOUR) {
      this.dayStartedAt = now
      this.spokenToday = 0
    }

    let front: { title: string; idleMs: number; fullscreen: boolean; typedWithinMs: number }
    try {
      const facts = readForeground()
      const idleMs = Math.max(0, powerMonitor.getSystemIdleTime()) * 1000
      front = { title: facts.title, idleMs, fullscreen: foregroundLooksFullscreen(), typedWithinMs: idleMs }
    } catch {
      return { spoke: false, reason: '读不到前台窗口，这次不开口' }
    }

    const decision = proactiveDecision({
      ...front,
      hidden: this.deps.hidden(),
      doNotDisturb: this.deps.doNotDisturb(),
      taskRunning: this.deps.taskRunning(),
      minutesSinceLast: this.lastSpokeAt === 0 ? 10_000 : Math.floor((now - this.lastSpokeAt) / 60_000),
      spokenThisHour: this.spokenThisHour,
      spokenToday: this.spokenToday,
      pace: this.deps.pace(),
      reasons: this.deps.reasons(),
      stage: this.deps.stage()
    })

    if (!decision.speak) return { spoke: false, reason: decision.reason }
    this.lastSpokeAt = now
    this.spokenThisHour += 1
    this.spokenToday += 1
    const line = this.deps.reasons()[0] ?? decision.reason
    this.deps.say(line)
    return { spoke: true, reason: line }
  }
}

function foregroundLooksFullscreen(): boolean {
  try {
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const raw = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FgRect {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$rect = New-Object FgRect+RECT
[void][FgRect]::GetWindowRect([FgRect]::GetForegroundWindow(), [ref]$rect)
@{ width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress
`], { encoding: 'utf8', windowsHide: true, timeout: 4000 })
    const rect = JSON.parse(raw) as { width?: number; height?: number }
    const display = screen.getPrimaryDisplay().bounds
    return (rect.width ?? 0) >= display.width - 8 && (rect.height ?? 0) >= display.height - 8
  } catch {
    return false
  }
}
