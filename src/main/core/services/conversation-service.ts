import type { SqliteDatabase } from '../../data/sqlite-types'
import type { ChatTurn } from '../../model/types'
import { ModelGateway } from '../../model/gateway'
import { composePrompt } from '../../agent/prompts'
import type { ModelRegistry } from '../../model/registry'
import { searchHistory, type HistorySearchResult } from '../../history/search'
import { compactContext } from '../../agent/runtime'
import { addressSequence } from '../../data/repositories/trace-repository'
import type { Conversation, Result } from '../../../shared/types'

const clone = <T>(value: T): T => structuredClone(value)
const nowStamp = (): string => new Date().toISOString()

function displayTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const clock = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.toDateString() === new Date().toDateString()) return clock
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
}
const uid = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

interface MessageRow {
  id: string
  role: 'user' | 'assistant'
  text: string
  created_at: string
}

interface ConversationRow {
  id: string
  title: string
  pinned: number
  updated_at: string
}

interface ModelAccess {
  getDefault(): ReturnType<ModelRegistry['getDefault']>
  markOffline(id: string): void
  markVerified(id: string, latencyMs: number): void
}

export interface ConversationContext {
  character?: () => { name: string; style: string; example: string }
  recall?: (query: string) => { text: string; ids: string[] } | Promise<{ text: string; ids: string[] }>
  memoryEnabled?: () => boolean
  onTurn?: (userText: string, conversationId: string) => void
  noticeTask?: (userText: string) => Promise<string | null>
  onReply?: (reply: string) => void
}

export class ConversationService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly models: ModelAccess,
    private readonly gateway: Pick<ModelGateway, 'chat'> = new ModelGateway(),
    private readonly context: ConversationContext = {}
  ) {}

  list(): Conversation[] {
    const rows = this.db
      .prepare(`SELECT id, title, pinned, updated_at FROM conversations ORDER BY updated_at DESC`)
      .all() as ConversationRow[]
    return rows.map((row) => this.hydrate(row))
  }

  search(keyword: string): HistorySearchResult {
    try {
      const conversations = this.list()
      const needle = keyword.trim().toLowerCase()
      if (!needle) {
        return searchHistory(conversations.map((item) => ({
          id: item.id,
          title: item.title,
          preview: item.messages.map((message) => message.text).join(' ')
        })), keyword)
      }
      const like = `%${needle.replace(/[%_]/g, '')}%`
      const hits = this.db.prepare(
        `SELECT conversation_id AS id, text AS preview FROM messages WHERE lower(text) LIKE ?`
      ).all(like) as Array<{ id: string; preview: string }>
      const ids = new Set(hits.map((hit) => hit.id))
      const matched = conversations.filter((item) => ids.has(item.id) || item.title.toLowerCase().includes(needle))
      return searchHistory(matched.map((item) => ({
        id: item.id,
        title: item.title,
        preview: item.messages.map((message) => message.text).join(' ')
      })), keyword)
    } catch {
      return searchHistory([], keyword, true)
    }
  }

  create(): Conversation {
    const id = uid('chat')
    const now = new Date().toISOString()
    this.db
      .prepare(`INSERT INTO conversations(id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, '新的对话', 0, now, now)
    const name = this.context.character?.().name?.trim()
    this.insertMessage(id, 'assistant', `${name ? `${name}在。` : '我在。'}想继续聊，还是从一件新事情开始？`, nowStamp())
    return this.require(id)
  }

  async send(
    conversationId: string,
    text: string,
    onDelta?: (delta: string) => void,
    onStart?: () => void
  ): Promise<Result<Conversation>> {
    const existing = this.findRow(conversationId)
    if (!existing) return fail('会话不存在或已被清除')
    const model = this.models.getDefault()
    if (!model) return fail('尚未配置模型，请先到「模型服务」填写服务地址、API Key 和模型名称')
    if (!model.model.trim()) return fail('当前模型尚未填写模型名称，请到「模型服务」补全配置')
    if (!model.endpoint.trim()) return fail('当前模型尚未填写服务地址，请到「模型服务」补全配置')

    const history = this.messages(conversationId)
    const compacted = compactContext(
      text,
      history.map((message) => ({ id: message.id, evidence: message.text.slice(0, 80) })),
      24
    )
    const recentIds = new Set(compacted.recent.map((step) => step.id))
    const messages: ChatTurn[] = history
      .filter((message) => recentIds.has(message.id))
      .map((message) => ({ role: message.role, content: message.text }))
    messages.push({ role: 'user', content: text })
    const character = this.context.character?.() ?? { name: '', style: '', example: '' }
    const prompt = composePrompt(character)
    const memoryEnabled = this.context.memoryEnabled?.() ?? false
    const recalled = memoryEnabled && this.context.recall
      ? await this.context.recall(text)
      : { text: '', ids: [] as string[] }
    const earlier = compacted.summary ? `\n更早的对话摘要：${compacted.summary.slice(0, 800)}` : ''
    const system = `${prompt.text}${earlier}${recalled.text ? `\n可参考的长期记忆：\n${recalled.text}` : ''}`

    onStart?.()
    let reply: string
    const startedAt = Date.now()
    try {
      reply = await this.gateway.chat(model, messages, onDelta, system)
    } catch (error) {
      this.models.markOffline(model.id)
      return fail(error instanceof Error ? error.message : '模型请求失败，请稍后重试')
    }
    if (!reply.trim()) return fail('模型返回了空内容，这次回复没有写入会话')
    if (this.context.noticeTask) {
      try {
        const note = await this.context.noticeTask(text)
        if (note) reply = `${reply}\n\n${note}`
      } catch {
        // 任务识别失败时保留已经生成的回复，不把闲聊说成任务。
      }
    }

    this.insertMessage(conversationId, 'user', text, nowStamp())
    this.insertMessage(conversationId, 'assistant', reply, nowStamp())
    const recordedAt = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO tool_calls(id, task_id, step_id, tool_id, declared_json, execution_json, verification_json, created_at, agent_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid('call'),
      'none',
      'prompt',
      'prompt',
      JSON.stringify({ intent: 'system-prompt', args: { prompts: prompt.prompts, memoryIds: recalled.ids } }),
      JSON.stringify({ status: 'ok', raw: null, startedAt: recordedAt, endedAt: recordedAt }),
      JSON.stringify({ method: 'prompt-version', evidence: [], verdict: 'confirmed' }),
      recordedAt,
      'prompt'
    )
    this.recordTrace(conversationId, [...messages.map((item) => String(item.content)), reply])
    const title = existing.title === '新的对话' ? text.slice(0, 24) : existing.title
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, new Date().toISOString(), conversationId)
    this.models.markVerified(model.id, Date.now() - startedAt)
    try {
      this.context.onTurn?.(text, conversationId)
      this.context.onReply?.(reply)
    } catch {
      // 提取失败时保留已经写好的回复和既有记忆。
    }
    return ok(this.require(conversationId))
  }

  countRunningTasks(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks WHERE status NOT IN ('已完成', '已取消', '失败', '部分完成', '已中断')`
      )
      .get() as { count: number }
    return row.count
  }

  deleteHistory(id: string): Conversation[] {
    this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id)
    this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
    return this.list()
  }

  /** 相同内容只存一份 blob，相同前缀只存一个节点，重述不额外占空间。 */
  private recordTrace(conversationId: string, messages: string[]): void {
    try {
      const { nodes, blobs } = addressSequence(messages)
      const insertBlob = this.db.prepare(`INSERT OR IGNORE INTO trace_blobs(blob_hash, body) VALUES (?, ?)`)
      for (const [hash, body] of blobs) insertBlob.run(hash, body)
      const insertNode = this.db.prepare(
        `INSERT OR IGNORE INTO trace_nodes(seq_hash, prev_hash, blob_hash, trace_id, span_id, parent_span_id, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const now = new Date().toISOString()
      nodes.forEach((node, index) => {
        insertNode.run(node.seqHash, node.prevHash, node.blobHash, conversationId, `${conversationId}-${index}`, node.prevHash, now, now)
      })
    } catch {
      // 轨迹存储失败不影响已经写好的会话内容。
    }
  }

  clearCache(): void {
    this.db.prepare(`DELETE FROM activities`).run()
  }

  private require(id: string): Conversation {
    const row = this.findRow(id)
    if (!row) throw new Error('会话不存在或已被清除')
    return this.hydrate(row)
  }

  private findRow(id: string): ConversationRow | undefined {
    return this.db
      .prepare(`SELECT id, title, pinned, updated_at FROM conversations WHERE id = ?`)
      .get(id) as ConversationRow | undefined
  }

  private messages(conversationId: string): MessageRow[] {
    return this.db
      .prepare(
        `SELECT id, role, text, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid`
      )
      .all(conversationId) as MessageRow[]
  }

  private insertMessage(conversationId: string, role: 'user' | 'assistant', text: string, time: string): void {
    this.db
      .prepare(
        `INSERT INTO messages(id, conversation_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(uid('msg'), conversationId, role, text, time)
  }

  private hydrate(row: ConversationRow): Conversation {
    const messages = this.messages(row.id).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      time: displayTime(message.created_at)
    }))
    const preview = messages.at(-1)?.text.slice(0, 32).replace(/\n/g, ' ') ?? '从一个问题开始…'
    return clone({
      id: row.id,
      title: row.title,
      time: displayTime(row.updated_at),
      preview,
      count: messages.length,
      pinned: row.pinned === 1,
      messages
    })
  }
}
