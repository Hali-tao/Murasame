# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: autonomy-external-status.spec.ts >> an already open autonomy page follows externally started real isolated work and stop
- Location: tests\e2e\autonomy-external-status.spec.ts:4:5

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('combobox')
Expected: "写代码"
Received: "浏览网页"
Timeout:  10000ms

Call log:
  - Expect "toHaveValue" getByRole('combobox') with timeout 10000ms
  - waiting for getByRole('combobox')
    23 × locator resolved to <select class="select">…</select>
       - unexpected value "浏览网页"

```

```yaml
- combobox "活动类型 打开网页后可以让它自己看、自己点，每一步都会重新截图核验。":
  - option "浏览网页" [selected]
  - option "看视频"
  - option "办公文档"
  - option "Python编程"
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'
  3  |
  4  | test('an already open autonomy page follows externally started real isolated work and stop', async () => {
  5  |   test.skip(process.env.MURASAME_E2E_ISOLATION !== '1', 'Requires the verified schema-3 Docker image')
  6  |   test.setTimeout(150_000)
  7  |   const server = await startModelServer({ toolResponse(tool) {
  8  |     if (tool === 'get_color') return { color: '蓝色' }
  9  |     if (tool === 'create_isolated_artifact') return { title: '跨入口真实产物', content: 'print(6 * 7)', expectedOutput: '42' }
  10 |     if (tool === 'review_isolated_artifact') return { accepted: true, reason: '固定模型边界；实际文件与输出由容器核验' }
  11 |     return undefined
  12 |   } })
  13 |   const app = await launchApp()
  14 |   try {
  15 |     const page = await findMainPage(app)
  16 |     const pet = await findPetPage(app)
  17 |     await configureTestModel(page, server.url)
  18 |     await page.getByTestId('nav-autonomy').click()
  19 |     await expect(page.getByTestId('autonomy-stop')).toBeDisabled()
  20 |     // Enter through the public preload API while this page is already idle.
  21 |     // Production IPC, service, Docker, event publication and rendering all run.
  22 |     const started = await page.evaluate(() => window.murasame.autonomy.start({ confirmed: true, allowNetwork: false, kind: 'code' }))
  23 |     expect(started.ok).toBe(true)
> 24 |     await expect(page.getByRole('combobox')).toHaveValue('写代码', { timeout: 10_000 })
     |                                              ^ Error: expect(locator).toHaveValue(expected) failed
  25 |     await expect(page.getByTestId('autonomy-stop')).toBeEnabled()
  26 |     await expect(page.getByAltText('离线隔离桌面实时画面')).toBeVisible({ timeout: 15_000 })
  27 |     await page.screenshot({ path: test.info().outputPath('externally-started-visible.png') })
  28 |     const created = await page.evaluate(() => window.murasame.autonomy.create('code', '打印6乘7的结果'))
  29 |     expect(created.ok).toBe(true)
  30 |     await expect(page.getByTestId('autonomy-export')).toBeEnabled()
  31 |     await expect(page.getByRole('heading', { name: '跨入口真实产物' })).toBeVisible()
  32 |     await expect(page.getByText('实际输出：', { exact: false })).toContainText('42')
  33 |     await expect(pet.getByTestId('pet-isolation-progress')).toContainText('产物已核验，待保存')
  34 |     await page.screenshot({ path: test.info().outputPath('external-real-code-result.png') })
  35 |     const stopped = await page.evaluate(() => window.murasame.autonomy.stop())
  36 |     expect(stopped.ok).toBe(true)
  37 |     await expect(page.getByTestId('autonomy-stop')).toBeDisabled()
  38 |     await expect(page.getByAltText('离线隔离桌面实时画面')).toHaveCount(0)
  39 |     await expect(page.getByTestId('autonomy-export')).toBeDisabled()
  40 |     await expect(pet.getByTestId('pet-isolation-progress')).toHaveCount(0)
  41 |     await page.screenshot({ path: test.info().outputPath('external-stop-synchronized.png') })
  42 |   } finally { await closeApp(app); await server.close() }
  43 | })
  44 |
```
