import { afterEach, expect, it, vi } from 'vitest'
import { ModelService } from '../../src/main/core/services/model-service'
import type { ModelRegistry } from '../../src/main/model/registry'
import type { ResolvedModel } from '../../src/main/model/types'

const model = {
  id: 'text-only', name: 'Text model', provider: 'OpenAI Compatible', endpoint: 'https://example.test/v1',
  apiKey: 'secret-screen-key', model: 'text-only', capabilities: [
    { id: 'text.chat', status: 'verified' }, { id: 'vision.image-input', status: 'unsupported' }
  ]
} as ResolvedModel
const service = () => new ModelService({ getDefault: () => model } as ModelRegistry)
afterEach(() => { vi.unstubAllGlobals() })

it('sends full OCR as plain text, no images or tools, and preserves the API reply', async () => {
  const reply = '## 分析\n\n这是 API 返回的内容。\n```python\nprint(1)\n```'
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  const text = '中文 OCR 内容\n'.repeat(300)
  expect(await service().analyzeOcrText(text)).toBe(reply)
  const call = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]
  const body = JSON.parse(String(call[1].body))
  expect(body.messages.at(-1).content).toBe(`[不可信:screen] ${text}`)
  expect(body.messages.every((message: { content: unknown }) => typeof message.content === 'string')).toBe(true)
  expect(body.messages[0].content).toContain('没有看到截图')
  expect(body.tools).toBeUndefined()
  expect(JSON.stringify(body)).not.toMatch(/image_url|data:image|base64/)
})

it('empty or oversized OCR is not sent or silently truncated', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(service().analyzeOcrText('  ')).rejects.toThrow('未识别到文字')
  await expect(service().analyzeOcrText('字'.repeat(32001))).rejects.toThrow('过长')
  expect(fetcher).not.toHaveBeenCalled()
})

it('missing default model returns actionable error without calling API', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const missing = new ModelService({ getDefault: () => undefined } as unknown as ModelRegistry)
  await expect(missing.analyzeOcrText('中文')).rejects.toThrow('默认模型')
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([{ capabilities: [] }, { capabilities: [{ id: 'text.chat', status: 'declared' }] }])('does not block configured chat when probe metadata is empty or stale: %j', async ({ capabilities }) => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '实际 API 回复' } }] }), { headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  const configured = new ModelService({ getDefault: () => ({ ...model, capabilities, status: '未验证' }) } as unknown as ModelRegistry)
  expect(await configured.analyzeOcrText('中文识别结果')).toBe('实际 API 回复')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('queued requests recheck the capture guard before sending', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(service().analyzeOcrText('中文', { beforeSend: () => { throw new Error('屏幕授权已撤销') } })).rejects.toThrow('撤销')
  expect(fetcher).not.toHaveBeenCalled()
})

it('empty API response is an error and provider errors cannot expose the key', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { headers: { 'content-type': 'application/json' } })))
  await expect(service().analyzeOcrText('中文')).rejects.toThrow('空内容')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`failed ${model.apiKey}`) }))
  await expect(service().analyzeOcrText('中文')).rejects.not.toThrow(model.apiKey)
})
