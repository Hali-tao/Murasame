# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: recording-hidden.spec.ts >> [FR-27] native tray and pet hiding end recording tracks without submitting voice
- Location: tests\e2e\recording-hidden.spec.ts:61:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '结束并识别' })
Expected: visible
Error: strict mode violation: getByRole('button', { name: '结束并识别' }) resolved to 2 elements:
    1) <button type="button" aria-label="关闭提示：正在录音，再点一次结束并识别">…</button> aka getByRole('button', { name: '关闭提示：正在录音，再点一次结束并识别' })
    2) <button type="button" class="composer-tool active">…</button> aka getByRole('button', { name: '结束并识别', exact: true })

Call log:
  - Expect "toBeVisible" getByRole('button', { name: '结束并识别' }) with timeout 5000ms
  - waiting for getByRole('button', { name: '结束并识别' })

```

# Test source

```ts
  1   | import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
  2   | import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'
  3   |
  4   | interface MediaFixture {
  5   |   context: AudioContext
  6   |   tracks: MediaStreamTrack[]
  7   |   hiddenEvents: number
  8   |   unsubscribe(): void
  9   | }
  10  | type MediaWindow = typeof window & { __recordingFixture: MediaFixture }
  11  | interface VoiceFixture { transcriptions: number; hold: boolean; release?: () => void }
  12  | type VoiceGlobal = typeof globalThis & { __voiceFixture: VoiceFixture }
  13  |
  14  | async function installVoiceFixture(app: ElectronApplication): Promise<void> {
  15  |   // The native window, IPC/preload, UI and recording implementation are real.
  16  |   // Only local STT is controlled; this test does not require model downloads.
  17  |   await app.evaluate(({ ipcMain }) => {
  18  |     const state: VoiceFixture = { transcriptions: 0, hold: false }
  19  |     ;(globalThis as VoiceGlobal).__voiceFixture = state
  20  |     ipcMain.removeHandler('voice:readiness')
  21  |     ipcMain.handle('voice:readiness', () => ({ stt: true, tts: false, detail: '端到端测试本地转写' }))
  22  |     ipcMain.removeHandler('voice:transcribe')
  23  |     ipcMain.handle('voice:transcribe', async () => {
  24  |       state.transcriptions++
  25  |       if (state.hold) await new Promise<void>((resolve) => { state.release = resolve })
  26  |       return { accepted: true, text: '隐藏后不应加入的转写', message: '' }
  27  |     })
  28  |   })
  29  | }
  30  |
  31  | async function installSyntheticMicrophone(page: Page): Promise<void> {
  32  |   await page.evaluate(() => {
  33  |     // Chromium's real MediaStream tracks make stop/readyState observable
  34  |     // without recording the user's physical microphone.
  35  |     const context = new AudioContext()
  36  |     const fixture: MediaFixture = { context, tracks: [], hiddenEvents: 0, unsubscribe: () => {} }
  37  |     const oscillator = context.createOscillator()
  38  |     const destination = context.createMediaStreamDestination()
  39  |     oscillator.connect(destination); oscillator.start()
  40  |     Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
  41  |       const stream = destination.stream.clone()
  42  |       fixture.tracks.push(...stream.getTracks())
  43  |       return stream
  44  |     } })
  45  |     fixture.unsubscribe = window.murasame.window.onHidden(() => { fixture.hiddenEvents++ })
  46  |     ;(window as MediaWindow).__recordingFixture = fixture
  47  |   })
  48  | }
  49  |
  50  | async function stopSyntheticMicrophone(page: Page): Promise<void> {
  51  |   if (page.isClosed()) return
  52  |   await page.evaluate(async () => {
  53  |     const fixture = (window as MediaWindow).__recordingFixture
  54  |     if (!fixture) return
  55  |     fixture.unsubscribe()
  56  |     fixture.tracks.forEach((track) => track.stop())
  57  |     await fixture.context.close()
  58  |   })
  59  | }
  60  |
  61  | test('[FR-27] native tray and pet hiding end recording tracks without submitting voice', async () => {
  62  |   const app = await launchApp()
  63  |   let main: Page | undefined; let pet: Page | undefined
  64  |   try {
  65  |     main = await findMainPage(app); pet = await findPetPage(app)
  66  |     await installVoiceFixture(app)
  67  |     await main.evaluate(async () => {
  68  |       const settings = await window.murasame.settings.get()
  69  |       await window.murasame.settings.update({ permissions: { ...settings.permissions, microphone: true }, speakReplies: false })
  70  |     })
  71  |     await main.getByTestId('nav-chat').click()
  72  |     await main.getByLabel('新建会话', { exact: true }).click()
  73  |     await main.getByTestId('chat-input').fill('隐藏前的草稿')
  74  |     await installSyntheticMicrophone(main)
  75  |     await main.getByRole('button', { name: '语音', exact: true }).click()
> 76  |     await expect(main.getByRole('button', { name: '结束并识别' })).toBeVisible()
      |                                                               ^ Error: expect(locator).toBeVisible() failed
  77  |     await main.getByTestId('hide-to-tray').click()
  78  |     await expect.poll(() => main!.evaluate(() => ({
  79  |       events: (window as MediaWindow).__recordingFixture.hiddenEvents,
  80  |       states: (window as MediaWindow).__recordingFixture.tracks.map((track) => track.readyState)
  81  |     }))).toMatchObject({ states: ['ended'] })
  82  |     expect(await main.evaluate(() => (window as MediaWindow).__recordingFixture.hiddenEvents)).toBeGreaterThan(0)
  83  |     await main.evaluate(() => window.murasame.window.showMain())
  84  |     await expect(main.getByRole('button', { name: '语音', exact: true })).toBeVisible()
  85  |     await expect(main.getByTestId('chat-input')).toHaveValue('隐藏前的草稿')
  86  |     expect(await main.evaluate(() => (window as MediaWindow).__recordingFixture.tracks.length)).toBe(1)
  87  |
  88  |     await installSyntheticMicrophone(pet)
  89  |     await pet.locator('.pet-character').focus()
  90  |     await pet.locator('.pet-character').press('Enter')
  91  |     const mic = pet.getByRole('button', { name: '按住说话' })
  92  |     await mic.hover(); await pet.mouse.down()
  93  |     await expect(mic).toHaveClass(/is-recording/)
  94  |     await main.evaluate(() => window.murasame.pet.hide())
  95  |     await expect.poll(() => pet!.evaluate(() => (window as MediaWindow).__recordingFixture.tracks.map((track) => track.readyState))).toEqual(['ended'])
  96  |     expect(await pet.evaluate(() => (window as MediaWindow).__recordingFixture.hiddenEvents)).toBeGreaterThan(0)
  97  |     await pet.mouse.up()
  98  |     await main.evaluate(() => window.murasame.pet.show())
  99  |     await expect(pet.getByRole('button', { name: '按住说话' })).not.toHaveClass(/is-recording/)
  100 |     expect(await app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.transcriptions)).toBe(0)
  101 |   } finally {
  102 |     if (main) await stopSyntheticMicrophone(main)
  103 |     if (pet) await stopSyntheticMicrophone(pet)
  104 |     await closeApp(app)
  105 |   }
  106 | })
  107 |
  108 | test('[FR-27] a transcription returning through IPC after native hide cannot change the draft', async () => {
  109 |   const app = await launchApp()
  110 |   let page: Page | undefined
  111 |   try {
  112 |     page = await findMainPage(app)
  113 |     await installVoiceFixture(app)
  114 |     await app.evaluate(() => { (globalThis as VoiceGlobal).__voiceFixture.hold = true })
  115 |     await page.evaluate(async () => {
  116 |       const settings = await window.murasame.settings.get()
  117 |       await window.murasame.settings.update({ permissions: { ...settings.permissions, microphone: true }, speakReplies: false })
  118 |     })
  119 |     await page.getByTestId('nav-chat').click()
  120 |     await page.getByLabel('新建会话', { exact: true }).click()
  121 |     await page.getByTestId('chat-input').fill('不能被迟到录音修改')
  122 |     await installSyntheticMicrophone(page)
  123 |     await page.getByRole('button', { name: '语音', exact: true }).click()
  124 |     await page.getByRole('button', { name: '结束并识别' }).click()
  125 |     await expect.poll(() => app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.transcriptions)).toBe(1)
  126 |     await page.getByTestId('hide-to-tray').click()
  127 |     await expect.poll(() => page!.evaluate(() => (window as MediaWindow).__recordingFixture.hiddenEvents)).toBeGreaterThan(0)
  128 |     await app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.release?.())
  129 |     await page.evaluate(() => window.murasame.window.showMain())
  130 |     await expect(page.getByTestId('chat-input')).toHaveValue('不能被迟到录音修改')
  131 |     await expect(page.getByRole('button', { name: '语音', exact: true })).toBeVisible()
  132 |   } finally {
  133 |     await app.evaluate(() => (globalThis as VoiceGlobal).__voiceFixture.release?.()).catch(() => undefined)
  134 |     if (page) await stopSyntheticMicrophone(page)
  135 |     await closeApp(app)
  136 |   }
  137 | })
  138 |
```
