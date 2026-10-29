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
Received: 2
Timeout:  8000ms

Call log:
  - Expect "toHaveCount" locator('.toast') with timeout 8000ms
  - waiting for locator('.toast')
    11 × locator resolved to 2 elements
       - unexpected value "2"

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
  9  |   const hostEvents: unknown[] = []
  10 |   try {
  11 |     await page.evaluate(() => {
  12 |       const diagnostic = window as unknown as { notificationEvents: unknown[] }
  13 |       diagnostic.notificationEvents = []
  14 |       const log = (kind: string, detail: unknown) => diagnostic.notificationEvents.push({ kind, detail, time: performance.now(), wall: Date.now(), visible: document.visibilityState, focus: document.hasFocus() })
  15 |       const original = window.setTimeout.bind(window)
  16 |       window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  17 |         if (delay !== 5000 || typeof callback !== 'function') return original(callback, delay, ...args)
  18 |         const start = performance.now()
  19 |         log('schedule', { delay, stack: new Error().stack })
  20 |         return original(() => { log('fired', { elapsed: performance.now() - start }); callback(...args) }, delay)
  21 |       }) as typeof window.setTimeout
  22 |       let last = ''
  23 |       new MutationObserver(() => {
  24 |         const text = Array.from(document.querySelectorAll('.toast')).map(el => el.textContent).join('|')
  25 |         if (text !== last) { last = text; log('toasts', text) }
  26 |       }).observe(document.body, { childList: true, subtree: true, characterData: true })
  27 |       new PerformanceObserver(list => { for (const item of list.getEntries()) log('longtask', { start: item.startTime, duration: item.duration }) }).observe({ entryTypes: ['longtask'] })
  28 |       document.addEventListener('visibilitychange', () => log('visibility', null))
  29 |     })
  30 |     await configureTestModel(page, server.url, '独立计时诊断')
  31 |     await page.getByTestId('nav-memory').click()
  32 |     await page.getByTestId('add-memory').click()
  33 |     await page.getByTestId('memory-category').fill('偏好')
  34 |     await page.getByTestId('memory-text').fill('独立界面测试：回答时优先说明结果。')
  35 |     await page.getByRole('button', { name: '添加记忆', exact: true }).click()
  36 |     await expect(page.getByRole('dialog')).toHaveCount(0)
  37 |     await page.getByTestId('nav-chat').click()
  38 |     await page.getByLabel('新建会话', { exact: true }).click()
  39 |     await page.getByTestId('chat-input').fill('确认通知不会挡住发送按钮')
  40 |     await page.screenshot({ path: test.info().outputPath('before.png') })
  41 |     await page.getByTestId('chat-send').click()
  42 |     await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
  43 |     hostEvents.push({ phase: 'before', host: { wall: Date.now(), perf: performance.now() }, page: await page.evaluate(() => ({ wall: Date.now(), perf: performance.now(), count: document.querySelectorAll('.toast').length })) })
> 44 |     await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 })
     |                                          ^ Error: expect(locator).toHaveCount(expected) failed
  45 |   } finally {
  46 |     hostEvents.push({ phase: 'after', host: { wall: Date.now(), perf: performance.now() }, page: await page.evaluate(() => ({ wall: Date.now(), perf: performance.now(), count: document.querySelectorAll('.toast').length })) })
  47 |     const events = await page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)
  48 |     writeFileSync(test.info().outputPath('events.json'), JSON.stringify({ hostEvents, events }, null, 2))
  49 |     await page.screenshot({ path: test.info().outputPath('after.png') })
  50 |     await closeApp(app); await server.close()
  51 |   }
  52 | })
  53 |
```
