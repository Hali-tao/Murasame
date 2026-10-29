# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notification-diagnostic.spec.ts >> measure routine toast lifetime without changing timer delays
- Location: previews\directory-checkpoints-2026-10-30\notification-diagnostic.spec.ts:5:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.toast')
Expected: 0
Received: 1
Timeout:  8000ms

Call log:
  - Expect "toHaveCount" locator('.toast') with timeout 8000ms
  - waiting for locator('.toast')
    10 × locator resolved to 2 elements
       - unexpected value "2"
    - locator resolved to 1 element
    - unexpected value "1"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | import { writeFileSync } from 'node:fs'
  3  | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from '../../tests/e2e/helpers'
  4  |
  5  | test('measure routine toast lifetime without changing timer delays', async () => {
  6  |   const server = await startModelServer()
  7  |   const app = await launchApp()
  8  |   const page = await findMainPage(app)
  9  |   try {
  10 |     await page.evaluate(() => {
  11 |       const diagnostic = window as unknown as { notificationEvents: unknown[] }
  12 |       diagnostic.notificationEvents = []
  13 |       const log = (kind: string, detail: unknown) => diagnostic.notificationEvents.push({ kind, detail, time: performance.now(), wall: Date.now(), visible: document.visibilityState, focus: document.hasFocus() })
  14 |       const original = window.setTimeout.bind(window)
  15 |       window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  16 |         if (delay !== 5000 || typeof callback !== 'function') return original(callback, delay, ...args)
  17 |         const start = performance.now()
  18 |         log('schedule', { delay, stack: new Error().stack })
  19 |         return original(() => { log('fired', { elapsed: performance.now() - start }); callback(...args) }, delay)
  20 |       }) as typeof window.setTimeout
  21 |       let last = ''
  22 |       new MutationObserver(() => {
  23 |         const text = Array.from(document.querySelectorAll('.toast')).map(el => el.textContent).join('|')
  24 |         if (text !== last) { last = text; log('toasts', text) }
  25 |       }).observe(document.body, { childList: true, subtree: true, characterData: true })
  26 |       new PerformanceObserver(list => { for (const item of list.getEntries()) log('longtask', { start: item.startTime, duration: item.duration }) }).observe({ entryTypes: ['longtask'] })
  27 |       document.addEventListener('visibilitychange', () => log('visibility', null))
  28 |     })
  29 |     await configureTestModel(page, server.url, '独立计时诊断')
  30 |     await page.getByTestId('nav-memory').click()
  31 |     await page.getByTestId('add-memory').click()
  32 |     await page.getByTestId('memory-category').fill('偏好')
  33 |     await page.getByTestId('memory-text').fill('独立界面测试：回答时优先说明结果。')
  34 |     await page.getByRole('button', { name: '添加记忆', exact: true }).click()
  35 |     await expect(page.getByRole('dialog')).toHaveCount(0)
  36 |     await page.getByTestId('nav-chat').click()
  37 |     await page.getByLabel('新建会话', { exact: true }).click()
  38 |     await page.getByTestId('chat-input').fill('确认通知不会挡住发送按钮')
  39 |     await page.screenshot({ path: test.info().outputPath('before.png') })
  40 |     await page.getByTestId('chat-send').click()
  41 |     await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
> 42 |     await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 })
     |                                          ^ Error: expect(locator).toHaveCount(expected) failed
  43 |   } finally {
  44 |     const events = await page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)
  45 |     writeFileSync(test.info().outputPath('events.json'), JSON.stringify(events, null, 2))
  46 |     await page.screenshot({ path: test.info().outputPath('after.png') })
  47 |     await closeApp(app); await server.close()
  48 |   }
  49 | })
  50 |
```
