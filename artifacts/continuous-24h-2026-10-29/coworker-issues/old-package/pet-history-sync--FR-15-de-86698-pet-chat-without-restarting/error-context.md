# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pet-history-sync.spec.ts >> [FR-15] deleting the active history clears the open pet chat without restarting
- Location: tests\e2e\pet-history-sync.spec.ts:4:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.pet-chat')
Expected substring: "这条历史删除后不应留在桌宠窗口"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('.pet-chat') with timeout 5000ms
  - waiting for locator('.pet-chat')

```

```yaml
- button "这是来自测试模型的真实流式回复。"
- button "拖动桌宠，单击打开对话"
- button "缩小桌宠"
- text: 90%
- button "放大桌宠"
- button "复位桌宠位置"
- button "隐藏桌宠"
- text: MURASAME
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
  14 |     await pet.evaluate(() => window.murasame.pet.setChatOpen(true))
> 15 |     await expect(pet.locator('.pet-chat')).toContainText('这条历史删除后不应留在桌宠窗口')
     |                                            ^ Error: expect(locator).toContainText(expected) failed
  16 |     await main.getByTestId('nav-history').click()
  17 |     await main.getByTestId('clear-history').click()
  18 |     await main.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
  19 |     await expect(main.getByTestId('history-item')).toHaveCount(0)
  20 |     await expect(pet.locator('.pet-chat')).not.toContainText('这条历史删除后不应留在桌宠窗口')
  21 |     await expect(pet.locator('.pet-chat')).not.toContainText('真实流式回复')
  22 |     await pet.screenshot({ path: test.info().outputPath('pet-history-cleared.png') })
  23 |   } finally { await closeApp(app); await server.close() }
  24 | })
  25 |
  26 | test('[FR-03] tapping the pet keeps chat visibility and the menu explicitly opens and closes it', async () => {
  27 |   const app = await launchApp()
  28 |   try {
  29 |     await findMainPage(app)
  30 |     const pet = await findPetPage(app)
  31 |     await expect(pet.getByTestId('live2d-canvas')).toBeVisible()
  32 |     await pet.evaluate(() => window.murasame.pet.setChatOpen(false))
  33 |     await pet.locator('.pet-character').click()
  34 |     await expect(pet.locator('.pet-chat')).toHaveCount(0)
  35 |     await pet.locator('.pet-character').click({ button: 'right' })
  36 |     await pet.getByRole('button', { name: '打开对话', exact: true }).click()
  37 |     await expect(pet.locator('.pet-chat')).toBeVisible()
  38 |     await pet.locator('.pet-character').click()
  39 |     await expect(pet.locator('.pet-chat')).toBeVisible()
  40 |     await pet.locator('.pet-character').click({ button: 'right' })
  41 |     await pet.getByRole('button', { name: '收起对话', exact: true }).first().click()
  42 |     await expect(pet.locator('.pet-chat')).toHaveCount(0)
  43 |     await pet.screenshot({ path: test.info().outputPath('pet-menu-controls-chat.png') })
  44 |   } finally { await closeApp(app) }
  45 | })
  46 |
```
