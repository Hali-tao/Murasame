import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

async function memories(page: Page) {
  const state = await page.evaluate(() => window.murasame.core.getBootstrap())
  if (!state.ok) throw new Error(state.error)
  return state.data.memories.map(({ text, source }) => ({ text, source }))
}

for (const removed of ['original', 'correction'] as const) {
  test(`[FR-15] clearing the ${removed} conversation keeps corrected memory in its actual source`, async () => {
    test.setTimeout(90_000)
    const model = resolve('build/bundled-models', EMBEDDING_MODEL_ID)
    const packaged = Boolean(process.env.MURASAME_E2E_EXECUTABLE)
    test.skip(!packaged && EMBEDDING_FILES.some(file => !existsSync(join(model, file))), 'Requires actual local BGE assets')
    const original = '我最近喜欢喝绿茶', correction = '更正一下，我现在喜欢喝白茶'
    const extractionInputs: string[] = []
    // Only the external model proposal is controlled. Chat, extraction, BGE,
    // persistence, source selection and clearing run through the real app.
    const server = await startModelServer({ toolResponse: (tool, messages) => {
      if (tool !== 'remember') return undefined
      const content = String(messages.filter(item => item.role === 'user').at(-1)?.content ?? '')
      extractionInputs.push(content)
      const text = content.split('用户刚才说：').at(-1)
      return { memories: text === original
        ? [{ action: 'ADD', category: 'user', text: '喜欢绿茶' }]
        : text === correction
          ? [{ action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: '喜欢绿茶' }]
          : [] }
    } })
    const app = await launchApp(true, userData => {
      if (packaged) return
      for (const file of EMBEDDING_FILES) {
        const target = join(userData, 'models', EMBEDDING_MODEL_ID, file)
        mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(model, file), target)
      }
    })
    try {
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(packaged)
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      const sendInNewConversation = async (text: string) => {
        await page.getByTestId('nav-chat').click()
        await page.getByLabel('新建会话', { exact: true }).click()
        await page.getByTestId('chat-input').fill(text)
        await page.getByTestId('chat-send').click()
        await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
        const state = await page.evaluate(() => window.murasame.core.getBootstrap())
        if (!state.ok) throw new Error(state.error)
        const conversation = state.data.conversations.find(item => item.messages.some(message => message.role === 'user' && message.text === text))
        if (!conversation) throw new Error('Missing actual persisted conversation')
        return conversation.id
      }
      const originalId = await sendInNewConversation(original)
      await expect.poll(() => memories(page), { timeout: 20_000 }).toEqual([{ text: '喜欢绿茶', source: originalId }])
      const correctionId = await sendInNewConversation(correction)
      await expect.poll(async () => (await memories(page)).map(item => item.text), { timeout: 20_000 }).toEqual(['喜欢白茶'])
      expect(extractionInputs.some(text => text.includes('- 喜欢绿茶') && text.endsWith(correction))).toBe(true)
      await test.info().attach('before-clear', { body: JSON.stringify(await memories(page)), contentType: 'application/json' })

      await page.getByTestId('nav-history').click()
      await page.getByTestId('history-item').filter({ hasText: removed === 'original' ? original : correction }).click()
      await page.getByTestId('clear-history').click()
      await page.getByRole('dialog').getByRole('checkbox', { name: /相关长期记忆/ }).check()
      await page.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await test.info().attach('after-clear', { body: JSON.stringify(await memories(page)), contentType: 'application/json' })
      await page.getByTestId('nav-memory').click()
      await page.screenshot({ path: test.info().outputPath(`${removed}-source-cleared.png`) })
      const expected = removed === 'original' ? [{ text: '喜欢白茶', source: correctionId }] : []
      expect(await memories(page)).toEqual(expected)
      await page.reload()
      await page.getByTestId('nav-memory').click()
      await expect(page.getByTestId('memory-card')).toHaveCount(expected.length)
      expect(await memories(page)).toEqual(expected)
      const remaining = await page.evaluate(() => window.murasame.core.getBootstrap())
      if (!remaining.ok) throw new Error(remaining.error)
      expect(remaining.data.conversations.some(item => item.id === (removed === 'original' ? originalId : correctionId))).toBe(false)
      expect(remaining.data.conversations.some(item => item.id === (removed === 'original' ? correctionId : originalId))).toBe(true)
    } finally { await closeApp(app); await server.close() }
  })
}
