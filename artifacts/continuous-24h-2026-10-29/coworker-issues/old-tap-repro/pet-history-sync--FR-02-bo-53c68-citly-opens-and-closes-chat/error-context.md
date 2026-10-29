# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pet-history-sync.spec.ts >> [FR-02] body taps give tap feedback and the menu explicitly opens and closes chat
- Location: tests\e2e\pet-history-sync.spec.ts:27:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('.live2d-pet-host')
Expected: "Tap"
Received: "Idle"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" locator('.live2d-pet-host') with timeout 5000ms
  - waiting for locator('.live2d-pet-host')
    14 × locator resolved to <div data-model-id="tororo" class="live2d-pet-host" data-motion-group="Idle" data-live2d-state="ready">…</div>
       - unexpected value "Idle"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'
  3  |
  4  | test('[FR-15] deleting the active history clears the open pet chat without restarting', async () => {
  5  |   const server = await startModelServer(), app = await launchApp()
  6  |   try {
  7  |     const main = await findMainPage(app), pet = await findPetPage(app)
  8  |     await configureTestModel(main, server.url)
  9  |     await main.getByTestId('nav-chat').click()
  10 |     await main.getByLabel('新建会话', { exact: true }).click()
  11 |     await main.getByTestId('chat-input').fill('这条历史删除后不应留在桌宠窗口')
  12 |     await main.getByTestId('chat-send').click()
  13 |     await expect(main.locator('.message-row.assistant').last()).toContainText('真实流式回复')
  14 |     await pet.locator('.pet-character').click({ button: 'right' })
  15 |     await pet.getByRole('button', { name: '打开对话', exact: true }).click()
  16 |     await expect(pet.locator('.pet-chat')).toContainText('这条历史删除后不应留在桌宠窗口')
  17 |     await main.getByTestId('nav-history').click()
  18 |     await main.getByTestId('clear-history').click()
  19 |     await main.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
  20 |     await expect(main.getByTestId('history-item')).toHaveCount(0)
  21 |     await expect(pet.locator('.pet-chat')).not.toContainText('这条历史删除后不应留在桌宠窗口')
  22 |     await expect(pet.locator('.pet-chat')).not.toContainText('真实流式回复')
  23 |     await pet.screenshot({ path: test.info().outputPath('pet-history-cleared.png') })
  24 |   } finally { await closeApp(app); await server.close() }
  25 | })
  26 |
  27 | test('[FR-02] body taps give tap feedback and the menu explicitly opens and closes chat', async () => {
  28 |   const app = await launchApp()
  29 |   try {
  30 |     await findMainPage(app)
  31 |     const pet = await findPetPage(app)
  32 |     await expect(pet.getByTestId('live2d-canvas')).toBeVisible()
  33 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Idle')
  34 |     await pet.evaluate(() => window.murasame.pet.setChatOpen(false))
  35 |     await pet.locator('.pet-character').click()
> 36 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Tap')
     |                                                   ^ Error: expect(locator).toHaveAttribute(expected) failed
  37 |     await expect(pet.locator('.pet-chat')).toHaveCount(0)
  38 |     await pet.locator('.pet-character').click({ button: 'right' })
  39 |     await pet.getByRole('button', { name: '打开对话', exact: true }).click()
  40 |     await expect(pet.locator('.pet-chat')).toBeVisible()
  41 |     await pet.locator('.pet-character').click()
  42 |     await expect(pet.locator('.pet-chat')).toBeVisible()
  43 |     await pet.locator('.pet-character').click({ button: 'right' })
  44 |     await pet.locator('.pet-menu').getByRole('button', { name: '收起对话', exact: true }).click()
  45 |     await expect(pet.locator('.pet-chat')).toHaveCount(0)
  46 |     await pet.screenshot({ path: test.info().outputPath('pet-menu-controls-chat.png') })
  47 |   } finally { await closeApp(app) }
  48 | })
  49 |
```
