import { globalShortcut } from 'electron'

let current = ''
let message = '唤起快捷键尚未注册'

export function noteHotkey(next: string): void {
  message = next
}

export function readHotkey(): string {
  return message
}

/** 换快捷键时先放掉旧的；新的注册不上就尽量恢复旧的，并如实说明。 */
export function applyHotkey(accelerator: string, onPress: () => void): { ok: boolean; message: string } {
  const next = accelerator.trim()
  const previous = current
  if (previous) globalShortcut.unregister(previous)
  let registered: boolean
  try {
    registered = next.length > 0 && globalShortcut.register(next, onPress)
  } catch {
    registered = false
  }
  if (registered) {
    current = next
    message = `${next} 已注册，可唤起桌宠对话`
    return { ok: true, message }
  }
  let restored: boolean
  try {
    restored = Boolean(previous) && previous !== next && globalShortcut.register(previous, onPress)
  } catch {
    restored = false
  }
  current = restored ? previous : ''
  message = restored
    ? `${next} 注册失败，可能被其他程序占用或写法不对。仍在使用 ${previous}。`
    : `${next} 注册失败，可能被其他程序占用或写法不对。请在设置里换一个组合，例如 Ctrl+Alt+M。`
  return { ok: false, message }
}
