# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pet-history-sync.spec.ts >> [FR-15] deleting the active history clears the open pet chat without restarting
- Location: tests\e2e\pet-history-sync.spec.ts:4:5

# Error details

```
Error: expect(locator).not.toContainText(expected) failed

Locator: locator('.pet-chat')
Expected substring: not "这条历史删除后不应留在桌宠窗口"
Received string: "我在。这条历史删除后不应留在桌宠窗口这是来自测试模型的真实流式回复。询问写图免问"
Timeout: 5000ms

Call log:
  - Expect "not toContainText" locator('.pet-chat') with timeout 5000ms
  - waiting for locator('.pet-chat')
    9 × locator resolved to <section data-pet-hit="true" class="pet-chat left" data-testid="pet-chat">…</section>
      - unexpected value "我在。这条历史删除后不应留在桌宠窗口这是来自测试模型的真实流式回复。询问写图免问"

```

```yaml
- button "新对话"
- button "收起对话"
- paragraph: 我在。
- paragraph: 这条历史删除后不应留在桌宠窗口
- paragraph: 这是来自测试模型的真实流式回复。
- group "写图片的权限":
  - button "询问" [pressed]
  - button "写图免问"
- textbox "对桌宠说":
  - /placeholder: 说点什么…
- button "按住说话"
- button "发送" [disabled]
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
> 21 |     await expect(pet.locator('.pet-chat')).not.toContainText('这条历史删除后不应留在桌宠窗口')
     |                                                ^ Error: expect(locator).not.toContainText(expected) failed
  22 |     await expect(pet.locator('.pet-chat')).not.toContainText('真实流式回复')
  23 |     await pet.screenshot({ path: test.info().outputPath('pet-history-cleared.png') })
  24 |   } finally { await closeApp(app); await server.close() }
  25 | })
  26 |
  27 | test('[FR-03] tapping the pet keeps chat visibility and the menu explicitly opens and closes it', async () => {
  28 |   const app = await launchApp()
  29 |   try {
  30 |     await findMainPage(app)
  31 |     const pet = await findPetPage(app)
  32 |     await expect(pet.getByTestId('live2d-canvas')).toBeVisible()
  33 |     await pet.evaluate(() => window.murasame.pet.setChatOpen(false))
  34 |     await pet.locator('.pet-character').click()
  35 |     await expect(pet.locator('.pet-chat')).toHaveCount(0)
  36 |     await pet.locator('.pet-character').click({ button: 'right' })
  37 |     await pet.getByRole('button', { name: '打开对话', exact: true }).click()
  38 |     await expect(pet.locator('.pet-chat')).toBeVisible()
  39 |     await pet.locator('.pet-character').click()
  40 |     await expect(pet.locator('.pet-chat')).toBeVisible()
  41 |     await pet.locator('.pet-character').click({ button: 'right' })
  42 |     await pet.getByRole('button', { name: '收起对话', exact: true }).first().click()
  43 |     await expect(pet.locator('.pet-chat')).toHaveCount(0)
  44 |     await pet.screenshot({ path: test.info().outputPath('pet-menu-controls-chat.png') })
  45 |   } finally { await closeApp(app) }
  46 | })
  47 |
```
