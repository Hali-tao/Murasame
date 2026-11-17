import { dialog, globalShortcut } from 'electron'
import { getSettings } from './settings'
import { openMainPath } from './windows'
import type { Result, ScreenAnalysis } from '../shared/types'

let current = ''
let message = '屏幕辅助快捷键尚未注册'
let running = false

export function readScreenHotkey(): string { return message }

export function applyScreenHotkey(accelerator: string, onPress: () => void): { ok: boolean; message: string } {
  const next = accelerator.trim()
  if (next === current && globalShortcut.isRegistered(next)) return { ok: true, message }
  let registered: boolean
  try { registered = Boolean(next) && globalShortcut.register(next, onPress) } catch { registered = false }
  if (!registered) {
    message = `${next} 注册失败，可能已被占用或格式不正确。${current ? `仍使用 ${current}。` : '请更换组合键。'}`
    return { ok: false, message }
  }
  if (current) globalShortcut.unregister(current)
  current = next
  message = `${next} 已注册，可分析当前窗口`
  return { ok: true, message }
}

/** Do not focus the console before capture: the user's foreground window is the target. */
export async function runScreenShortcut(core: { analyzeScreen(): Promise<Result<ScreenAnalysis>> }): Promise<void> {
  if (running) return
  if (!getSettings().permissions.screen) { openMainPath('/settings'); return }
  running = true
  try {
    const result = await core.analyzeScreen()
    openMainPath('/screen')
    if (!result.ok) await dialog.showMessageBox({ type: 'warning', title: '屏幕辅助未完成', message: result.error })
  } catch (error) {
    openMainPath('/screen')
    await dialog.showMessageBox({ type: 'warning', title: '屏幕辅助未完成', message: error instanceof Error ? error.message : String(error) })
  } finally { running = false }
}
