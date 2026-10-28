import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

interface MediaFixture {
  context: AudioContext
  tracks: MediaStreamTrack[]
  hiddenEvents: number
  unsubscribe(): void
}
type MediaWindow = typeof window & { __recordingFixture: MediaFixture }
interface VoiceFixture { transcriptions: number; hold: boolean; release?: () => void }
type VoiceGlobal = typeof globalThis & { __voiceFixture: VoiceFixture }

async function installVoiceFixture(app: ElectronApplication): Promise<void> {
  // The native window, IPC/preload, UI and recording implementation are real.
  // Only local STT is controlled; this test does not require model downloads.
  await app.evaluate(({ ipcMain }) => {
    const state: VoiceFixture = { transcriptions: 0, hold: false }
    ;(globalThis as VoiceGlobal).__voiceFixture = state
    ipcMain.removeHandler('voice:readiness')
    ipcMain.handle('voice:readiness', () => ({ stt: true, tts: false, detail: '端到端测试本地转写' }))
    ipcMain.removeHandler('voice:transcribe')
    ipcMain.handle('voice:transcribe', async () => {
      state.transcriptions++
      if (state.hold) await new Promise<void>((resolve) => { state.release = resolve })
      return { accepted: true, text: '隐藏后不应加入的转写', message: '' }
    })
  })
}

async function installSyntheticMicrophone(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Chromium's real MediaStream tracks make stop/readyState observable
    // without recording the user's physical microphone.
    const context = new AudioContext()
    const fixture: MediaFixture = { context, tracks: [], hiddenEvents: 0, unsubscribe: () => {} }
    const oscillator = context.createOscillator()
    const destination = context.createMediaStreamDestination()
    oscillator.connect(destination); oscillator.start()
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const stream = destination.stream.clone()
      fixture.tracks.push(...stream.getTracks())
      return stream
    } })
    fixture.unsubscribe = window.murasame.window.onHidden(() => { fixture.hiddenEvents++ })
    ;(window as MediaWindow).__recordingFixture = fixture
  })
}

async function stopSyntheticMicrophone(page: Page): Promise<void> {
  if (page.isClosed()) return
  await page.evaluate(async () => {
    const fixture = (window as MediaWindow).__recordingFixture
    if (!fixture) return
    fixture.unsubscribe()
    fixture.tracks.forEach((track) => track.stop())
    await fixture.context.close()
  })
}

test('[FR-27] native tray and pet hiding end recording tracks without submitting voice', async () => {
  const app = await launchApp()
  let main: Page | undefined; let pet: Page | undefined
  try {
    main = await findMainPage(app); pet = await findPetPage(app)
    await installVoiceFixture(app)
    await main.evaluate(async () => {
      const settings = await window.murasame.settings.get()
      await window.murasame.settings.update({ permissions: { ...settings.permissions, microphone: true }, speakReplies: false })
    })
    await main.getByTestId('nav-chat').click()
    await main.getByLabel('新建会话', { exact: true }).click()
    await main.getByTestId('chat-input').fill('隐藏前的草稿')
    await installSyntheticMicrophone(main)
    await main.getByRole('button', { name: '语音', exact: true }).click()
    await expect(main.getByRole('button', { name: '结束并识别' })).toBeVisible()
    await main.getByTestId('hide-to-tray').click()
    await expect.poll(() => main!.evaluate(() => ({
      events: (window as MediaWindow).__recordingFixture.hiddenEvents,
      states: (window as MediaWindow).__recordingFixture.tracks.map((track) => track.readyState)
    }))).toMatchObject({ states: ['ended'] })
    expect(await main.evaluate(() => (window as MediaWindow).__recordingFixture.hiddenEvents)).toBeGreaterThan(0)
    await main.evaluate(() => window.murasame.window.showMain())
    await expect(main.getByRole('button', { name: '语音', exact: true })).toBeVisible()
    await expect(main.getByTestId('chat-input')).toHaveValue('隐藏前的草稿')
    expect(await main.evaluate(() => (window as MediaWindow).__recordingFixture.tracks.length)).toBe(1)

    await installSyntheticMicrophone(pet)
    await pet.locator('.pet-character').focus()
    await pet.locator('.pet-character').press('Enter')
    const mic = pet.getByRole('button', { name: '按住说话' })
    await mic.hover(); await pet.mouse.down()
    await expect(mic).toHaveClass(/is-recording/)
    await main.evaluate(() => window.murasame.pet.hide())
    await expect.poll(() => pet!.evaluate(() => (window as MediaWindow).__recordingFixture.tracks.map((track) => track.readyState))).toEqual(['ended'])
    expect(await pet.evaluate(() => (window as MediaWindow).__recordingFixture.hiddenEvents)).toBeGreaterThan(0)
    await pet.mouse.up()
    await main.evaluate(() => window.murasame.pet.show())
    await expect(pet.getByRole('button', { name: '按住说话' })).not.toHaveClass(/is-recording/)
    expect(await app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.transcriptions)).toBe(0)
  } finally {
    if (main) await stopSyntheticMicrophone(main)
    if (pet) await stopSyntheticMicrophone(pet)
    await closeApp(app)
  }
})

test('[FR-27] a transcription returning through IPC after native hide cannot change the draft', async () => {
  const app = await launchApp()
  let page: Page | undefined
  try {
    page = await findMainPage(app)
    await installVoiceFixture(app)
    await app.evaluate(() => { (globalThis as VoiceGlobal).__voiceFixture.hold = true })
    await page.evaluate(async () => {
      const settings = await window.murasame.settings.get()
      await window.murasame.settings.update({ permissions: { ...settings.permissions, microphone: true }, speakReplies: false })
    })
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('不能被迟到录音修改')
    await installSyntheticMicrophone(page)
    await page.getByRole('button', { name: '语音', exact: true }).click()
    await page.getByRole('button', { name: '结束并识别' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.transcriptions)).toBe(1)
    await page.getByTestId('hide-to-tray').click()
    await expect.poll(() => page!.evaluate(() => (window as MediaWindow).__recordingFixture.hiddenEvents)).toBeGreaterThan(0)
    await app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.release?.())
    await page.evaluate(() => window.murasame.window.showMain())
    await expect(page.getByTestId('chat-input')).toHaveValue('不能被迟到录音修改')
    await expect(page.getByRole('button', { name: '语音', exact: true })).toBeVisible()
  } finally {
    await app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.release?.()).catch(() => undefined)
    if (page) await stopSyntheticMicrophone(page)
    await closeApp(app)
  }
})
