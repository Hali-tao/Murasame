# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-correction-source.spec.ts >> [FR-15] clearing the original conversation keeps corrected memory in its actual source
- Location: tests\e2e\memory-correction-source.spec.ts:14:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 6
+ Received  + 1

- Array [
-   Object {
-     "source": "chat-1793266248698-sch7u",
-     "text": "喜欢白茶",
-   },
- ]
+ Array []
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test'
  2  | import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
  3  | import { dirname, join, resolve } from 'node:path'
  4  | import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
  5  | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  6  |
  7  | async function memories(page: Page) {
  8  |   const state = await page.evaluate(() => window.murasame.core.getBootstrap())
  9  |   if (!state.ok) throw new Error(state.error)
  10 |   return state.data.memories.map(({ text, source }) => ({ text, source }))
  11 | }
  12 |
  13 | for (const removed of ['original', 'correction'] as const) {
  14 |   test(`[FR-15] clearing the ${removed} conversation keeps corrected memory in its actual source`, async () => {
  15 |     test.setTimeout(90_000)
  16 |     const model = resolve('build/bundled-models', EMBEDDING_MODEL_ID)
  17 |     const packaged = Boolean(process.env.MURASAME_E2E_EXECUTABLE)
  18 |     test.skip(!packaged && EMBEDDING_FILES.some(file => !existsSync(join(model, file))), 'Requires actual local BGE assets')
  19 |     const original = '我最近喜欢喝绿茶', correction = '更正一下，我现在喜欢喝白茶'
  20 |     const extractionInputs: string[] = []
  21 |     // Only the external model proposal is controlled. Chat, extraction, BGE,
  22 |     // persistence, source selection and clearing run through the real app.
  23 |     const server = await startModelServer({ toolResponse: (tool, messages) => {
  24 |       if (tool !== 'remember') return undefined
  25 |       const content = String(messages.filter(item => item.role === 'user').at(-1)?.content ?? '')
  26 |       extractionInputs.push(content)
  27 |       const text = content.split('用户刚才说：').at(-1)
  28 |       return { memories: text === original
  29 |         ? [{ action: 'ADD', category: 'user', text: '喜欢绿茶' }]
  30 |         : text === correction
  31 |           ? [{ action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: '喜欢绿茶' }]
  32 |           : [] }
  33 |     } })
  34 |     const app = await launchApp(true, userData => {
  35 |       if (packaged) return
  36 |       for (const file of EMBEDDING_FILES) {
  37 |         const target = join(userData, 'models', EMBEDDING_MODEL_ID, file)
  38 |         mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(model, file), target)
  39 |       }
  40 |     })
  41 |     try {
  42 |       expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(packaged)
  43 |       const page = await findMainPage(app)
  44 |       await configureTestModel(page, server.url)
  45 |       const sendInNewConversation = async (text: string) => {
  46 |         await page.getByTestId('nav-chat').click()
  47 |         await page.getByLabel('新建会话', { exact: true }).click()
  48 |         await page.getByTestId('chat-input').fill(text)
  49 |         await page.getByTestId('chat-send').click()
  50 |         await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
  51 |         const state = await page.evaluate(() => window.murasame.core.getBootstrap())
  52 |         if (!state.ok) throw new Error(state.error)
  53 |         const conversation = state.data.conversations.find(item => item.messages.some(message => message.role === 'user' && message.text === text))
  54 |         if (!conversation) throw new Error('Missing actual persisted conversation')
  55 |         return conversation.id
  56 |       }
  57 |       const originalId = await sendInNewConversation(original)
  58 |       await expect.poll(() => memories(page), { timeout: 20_000 }).toEqual([{ text: '喜欢绿茶', source: originalId }])
  59 |       const correctionId = await sendInNewConversation(correction)
  60 |       await expect.poll(async () => (await memories(page)).map(item => item.text), { timeout: 20_000 }).toEqual(['喜欢白茶'])
  61 |       expect(extractionInputs.some(text => text.includes('- 喜欢绿茶') && text.endsWith(correction))).toBe(true)
  62 |       await test.info().attach('before-clear', { body: JSON.stringify(await memories(page)), contentType: 'application/json' })
  63 |
  64 |       await page.getByTestId('nav-history').click()
  65 |       await page.getByTestId('history-item').filter({ hasText: removed === 'original' ? original : correction }).click()
  66 |       await page.getByTestId('clear-history').click()
  67 |       await page.getByRole('dialog').getByRole('checkbox', { name: /相关长期记忆/ }).check()
  68 |       await page.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
  69 |       await expect(page.getByRole('dialog')).toHaveCount(0)
  70 |       await test.info().attach('after-clear', { body: JSON.stringify(await memories(page)), contentType: 'application/json' })
  71 |       await page.getByTestId('nav-memory').click()
  72 |       await page.screenshot({ path: test.info().outputPath(`${removed}-source-cleared.png`) })
  73 |       const expected = removed === 'original' ? [{ text: '喜欢白茶', source: correctionId }] : []
> 74 |       expect(await memories(page)).toEqual(expected)
     |                                    ^ Error: expect(received).toEqual(expected) // deep equality
  75 |       await page.reload()
  76 |       await page.getByTestId('nav-memory').click()
  77 |       await expect(page.getByTestId('memory-card')).toHaveCount(expected.length)
  78 |       expect(await memories(page)).toEqual(expected)
  79 |       const remaining = await page.evaluate(() => window.murasame.core.getBootstrap())
  80 |       if (!remaining.ok) throw new Error(remaining.error)
  81 |       expect(remaining.data.conversations.some(item => item.id === (removed === 'original' ? originalId : correctionId))).toBe(false)
  82 |       expect(remaining.data.conversations.some(item => item.id === (removed === 'original' ? correctionId : originalId))).toBe(true)
  83 |     } finally { await closeApp(app); await server.close() }
  84 |   })
  85 | }
  86 |
```
