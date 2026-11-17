import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  register: vi.fn(), unregister: vi.fn(), isRegistered: vi.fn(), open: vi.fn(), dialog: vi.fn(), allowed: true
}))
vi.mock('electron', () => ({ globalShortcut: { register: h.register, unregister: h.unregister, isRegistered: h.isRegistered }, dialog: { showMessageBox: h.dialog } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ permissions: { screen: h.allowed } }) }))
vi.mock('../../src/main/windows', () => ({ openMainPath: h.open }))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); h.allowed = true; h.register.mockReturnValue(true); h.isRegistered.mockReturnValue(true); h.dialog.mockResolvedValue({ response: 0 }) })
it('registers the new shortcut before releasing the old one, retaining it on conflicts', async () => {
  const { applyScreenHotkey } = await import('../../src/main/screen-hotkey')
  const callback = vi.fn()
  expect(applyScreenHotkey('Ctrl+Alt+Q', callback).ok).toBe(true)
  h.register.mockReturnValueOnce(false)
  expect(applyScreenHotkey('Alt+Space', callback).ok).toBe(false)
  expect(h.unregister).not.toHaveBeenCalled()
  expect(applyScreenHotkey('Ctrl+Alt+Y', callback).ok).toBe(true)
  expect(h.unregister).toHaveBeenCalledWith('Ctrl+Alt+Q')
})
it('handles invalid accelerators without losing the registered shortcut', async () => {
  const { applyScreenHotkey } = await import('../../src/main/screen-hotkey')
  applyScreenHotkey('Ctrl+Alt+Q', vi.fn())
  h.register.mockImplementationOnce(() => { throw new Error('invalid') })
  expect(applyScreenHotkey('not-a-key', vi.fn()).ok).toBe(false)
  expect(h.unregister).not.toHaveBeenCalled()
})
it('keeps the target foreground until analysis resolves and ignores repeated presses', async () => {
  const { runScreenShortcut } = await import('../../src/main/screen-hotkey')
  let finish!: (value: { ok: false; error: string }) => void
  const analyzeScreen = vi.fn(() => new Promise<{ ok: false; error: string }>(resolve => { finish = resolve }))
  const pending = runScreenShortcut({ analyzeScreen })
  await runScreenShortcut({ analyzeScreen })
  expect(analyzeScreen).toHaveBeenCalledTimes(1)
  expect(h.open).not.toHaveBeenCalled()
  finish({ ok: false, error: 'test failure' }); await pending
  expect(h.open).toHaveBeenCalledWith('/screen')
  expect(h.dialog).toHaveBeenCalledWith(expect.objectContaining({ message: 'test failure' }))
})
it('does not capture without authorization', async () => {
  const { runScreenShortcut } = await import('../../src/main/screen-hotkey')
  h.allowed = false
  const analyzeScreen = vi.fn()
  await runScreenShortcut({ analyzeScreen })
  expect(analyzeScreen).not.toHaveBeenCalled()
  expect(h.open).toHaveBeenCalledWith('/settings')
})
it('releases the guard after errors so the user can retry', async () => {
  const { runScreenShortcut } = await import('../../src/main/screen-hotkey')
  const analyzeScreen = vi.fn().mockRejectedValueOnce(new Error('capture failed')).mockResolvedValue({ ok: true, data: {} })
  await runScreenShortcut({ analyzeScreen }); await runScreenShortcut({ analyzeScreen })
  expect(analyzeScreen).toHaveBeenCalledTimes(2)
})

it('cancelling region selection does not open the results page', async () => {
  const { runScreenShortcut } = await import('../../src/main/screen-hotkey')
  await runScreenShortcut({ analyzeScreen: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true } }) })
  expect(h.open).not.toHaveBeenCalled()
  expect(h.dialog).not.toHaveBeenCalled()
})
