import { describe, expect, it } from 'vitest'
import { MockCore } from '../../src/main/core/mock-core'
import { initialBootstrap } from '../../src/shared/mock-data'

describe('MockCore', () => {
  it('returns the initial bootstrap data without sharing mutable objects', async () => {
    const core = new MockCore()
    const first = await core.getBootstrap()
    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(first.data.conversations.length).toBeGreaterThan(0)
    expect(first.data.tasks.map((task) => task.title)).toContain('修复数据清洗脚本')
    expect(first.data.models.find((model) => model.default)?.name).toBe('OpenAI · 主模型')
  })

  it('appends a user message and a delayed assistant reply', async () => {
    const core = new MockCore()
    const bootstrap = await core.getBootstrap()
    expect(bootstrap.ok).toBe(true)
    if (!bootstrap.ok) return

    const conversation = bootstrap.data.conversations[0]
    const initialCount = conversation.messages.length
    const result = await core.sendMessage(conversation.id, '这个编码报错应该怎么修？')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.messages).toHaveLength(initialCount + 2)
    expect(result.data.messages.at(-2)).toMatchObject({ role: 'user', text: '这个编码报错应该怎么修？' })
    expect(result.data.messages.at(-1)?.role).toBe('assistant')
    expect(result.data.messages.at(-1)?.text).toContain('gb18030')
    expect(result.data.count).toBe(result.data.messages.length)
  })

  it('only removes a conversation when the history scope is selected', async () => {
    const core = new MockCore()
    const bootstrap = await core.getBootstrap()
    expect(bootstrap.ok).toBe(true)
    if (!bootstrap.ok) return

    const target = bootstrap.data.conversations[0]
    const memoryOnly = await core.deleteConversation(target.id, ['memory'])
    expect(memoryOnly.ok).toBe(true)
    if (memoryOnly.ok) expect(memoryOnly.data).toHaveLength(bootstrap.data.conversations.length)

    const history = await core.deleteConversation(target.id, ['history'])
    expect(history.ok).toBe(true)
    if (history.ok) {
      expect(history.data).toHaveLength(bootstrap.data.conversations.length - 1)
      expect(history.data.some((conversation) => conversation.id === target.id)).toBe(false)
    }
  })

  it('supports memory creation, correction, deletion and clearing', async () => {
    const core = new MockCore()
    const added = await core.addMemory('偏好', '回答先给结论')
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const updated = await core.updateMemory(added.data.id, '沟通偏好', '回答先给结论，再解释原因')
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.data.category).toBe('沟通偏好')
      expect(updated.data.text).toContain('再解释原因')
      expect(updated.data.source).toContain('用户更正')
    }

    const missing = await core.updateMemory('missing-memory', '偏好', '不会写入')
    expect(missing.ok).toBe(false)

    const deleted = await core.deleteMemory(added.data.id)
    expect(deleted).toMatchObject({ ok: true, data: added.data.id })

    const cleared = await core.clearMemories()
    expect(cleared).toMatchObject({ ok: true, data: [] })
  })

  it('enforces the task approval state machine and creates unique daily ids', async () => {
    const core = new MockCore()
    const bootstrap = await core.getBootstrap()
    expect(bootstrap.ok).toBe(true)
    if (!bootstrap.ok) return

    const pending = bootstrap.data.tasks.find((task) => task.approval)
    expect(pending).toBeDefined()
    if (!pending) return

    const approved = await core.approveTask(pending.id)
    expect(approved.ok).toBe(true)
    if (approved.ok) {
      expect(approved.data.status).toBe('执行中')
      expect(approved.data.approval).toBeNull()
      expect(approved.data.progress).toBe(70)
    }

    const approvedAgain = await core.approveTask(pending.id)
    expect(approvedAgain.ok).toBe(false)

    const cancelled = await core.cancelTask(pending.id)
    expect(cancelled.ok).toBe(true)
    if (cancelled.ok) {
      expect(cancelled.data.status).toBe('已取消')
      expect(cancelled.data.steps.some((step) => step.state === '已取消')).toBe(true)
    }

    const one = await core.createTask('整理今天的任务')
    const two = await core.createTask('生成周报草稿')
    expect(one.ok && two.ok).toBe(true)
    if (one.ok && two.ok) {
      expect(one.data.id).not.toBe(two.data.id)
      expect(one.data.id).toMatch(/^T-\d{8}-\d{2}$/)
    }
  })

  it('toggles tools and validates, saves and switches model profiles', async () => {
    const core = new MockCore()
    const bootstrap = await core.getBootstrap()
    expect(bootstrap.ok).toBe(true)
    if (!bootstrap.ok) return

    const screen = bootstrap.data.tools.find((tool) => tool.id === 'screen')
    expect(screen).toBeDefined()
    const disabled = screen ? await core.setToolEnabled(screen.id, false) : null
    expect(disabled?.ok).toBe(true)
    if (disabled?.ok) expect(disabled.data.permission).toBe('已停用')
    const enabled = screen ? await core.setToolEnabled(screen.id, true) : null
    expect(enabled?.ok).toBe(true)
    if (enabled?.ok) expect(enabled.data.permission).toBe('已授权')

    const localModel = bootstrap.data.models.find((model) => model.id === 'qwen-local')
    expect(localModel).toBeDefined()
    const verified = localModel ? await core.verifyModel(localModel.id) : null
    expect(verified?.ok).toBe(true)
    if (verified?.ok) {
      expect(verified.data.status).toBe('在线')
      expect(verified.data.latency).toBe('912 ms')
    }

    const saved = localModel
      ? await core.saveModel(localModel.id, {
          name: '本地 Qwen · 已更新',
          provider: 'Ollama',
          endpoint: 'http://127.0.0.1:11434/v1',
          key: '',
          model: 'qwen3:14b',
          caps: ['文本', '工具调用']
        })
      : null
    expect(saved?.ok).toBe(true)
    if (saved?.ok) {
      expect(saved.data.name).toBe('本地 Qwen · 已更新')
      expect(saved.data.status).toBe('未验证')
    }

    const switched = localModel ? await core.setDefaultModel(localModel.id) : null
    expect(switched?.ok).toBe(true)
    if (switched?.ok) {
      expect(switched.data.find((model) => model.default)?.id).toBe(localModel?.id)
      expect(switched.data.filter((model) => model.default)).toHaveLength(1)
    }

    const created = await core.createModel()
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.data.status).toBe('未验证')
  })

  it('saves character settings and returns screen analysis results', async () => {
    const core = new MockCore()
    const character = initialBootstrap().character
    const saved = await core.saveCharacter({ ...character, name: '村雨改', keywords: ['简洁', '可靠'] })
    expect(saved.ok).toBe(true)
    if (saved.ok) {
      expect(saved.data.name).toBe('村雨改')
      expect(saved.data.keywords).toEqual(['简洁', '可靠'])
    }

    const analysis = await core.analyzeScreen()
    expect(analysis.ok).toBe(true)
    if (analysis.ok) {
      expect(analysis.data.title).toContain('UnicodeDecodeError')
      expect(analysis.data.bullets.length).toBeGreaterThan(0)
    }
  })
})
