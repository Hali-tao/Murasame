import type { SqliteDatabase } from '../../data/sqlite-types'
import type { ChatTurn, ResolvedModel } from '../../model/types'
import { ModelGateway } from '../../model/gateway'
import { composePrompt } from '../../agent/prompts'
import type { ModelRegistry } from '../../model/registry'
import { searchHistory, type HistorySearchResult } from '../../history/search'
import { compactContext, RequestQueue } from '../../agent/runtime'
import { petLine, petSpeech, routeUtterance, type StepPose, type TeammateRoute } from '../../agent/teammates'
import { addressSequence } from '../../data/repositories/trace-repository'
import type { Conversation, MemoryRecallEvent, MemoryRecallSource, MemoryRecallStatus, Result } from '../../../shared/types'

const clone = <T>(value: T): T => structuredClone(value)
const nowStamp = (): string => new Date().toISOString()

interface RecallRow {
  conversationId: string
  at: string
  declared: string
  title: string | null
}

const RECENT_RECALL_LIMIT = 5

/**
 * 从 prompt 工具调用记录里汇总「每条记忆被真正召回」的来源：最近一次、总次数、最近若干次事件。
 * 只认实际写入模型上下文的 memoryIds；解析失败的单行跳过，不影响其它记忆。
 */
export function collectRecallSources(rows: readonly RecallRow[]): MemoryRecallSource[] {
  const byMemory = new Map<string, { latest: MemoryRecallEvent; count: number; recent: MemoryRecallEvent[] }>()
  for (const row of rows) {
    try {
      const args = (JSON.parse(row.declared) as { args?: { turnId?: unknown; memoryIds?: unknown } } | null)?.args
      if (!args || !Array.isArray(args.memoryIds)) continue
      for (const memoryId of args.memoryIds) {
        if (typeof memoryId !== 'string' || !memoryId) continue
        const event: MemoryRecallEvent = {
          conversationId: row.conversationId,
          conversationTitle: row.title?.trim() || '已删除的对话',
          turnId: typeof args.turnId === 'string' ? args.turnId : '',
          at: row.at
        }
        const existing = byMemory.get(memoryId)
        if (!existing) {
          byMemory.set(memoryId, { latest: event, count: 1, recent: [event] })
          continue
        }
        existing.count += 1
        if (existing.recent.length < RECENT_RECALL_LIMIT) existing.recent.push(event)
      }
    } catch {
      // 损坏的历史记录不应影响其它召回来源。
    }
  }
  return [...byMemory.entries()].map(([memoryId, entry]) => ({
    memoryId,
    ...entry.latest,
    count: entry.count,
    recent: entry.recent
  }))
}

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
const notify = (observer: () => void): void => {
  try { observer() } catch { /* A secondary observer cannot cancel a completed turn. */ }
}

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
  markOffline(id: string, expected?: ResolvedModel): void
  markVerified(id: string, latencyMs: number, expected?: ResolvedModel): void
}

interface RecalledContext {
  text: string
  ids: string[]
  degraded?: boolean
  skipped?: 'disabled' | 'changed'
}

export interface ConversationContext {
  character?: () => { name: string; style: string; example: string }
  recall?: (query: string) => RecalledContext | Promise<RecalledContext>
  memoryEnabled?: () => boolean
  relationship?: () => { stage: string; tone?: string; joke?: string }
  onRecall?: (conversationId: string, detail: { turnId: string; ids: string[] }) => void
  onTurn?: (userText: string, conversationId: string) => void
  noticeTask?: (userText: string) => Promise<string | null>
  onReply?: (reply: string, pose?: StepPose) => void
  /** 非闲聊在调用对话模型之前交给队友。返回桌宠要说的那一句，以及这一步该做的动作。 */
  handleTeammate?: (userText: string, route: TeammateRoute) => Promise<{ say: string; pose?: StepPose }>
}

export class ConversationService {
  private readonly queues = new Map<string, RequestQueue>()
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

  has(id: string | null): boolean { return Boolean(id && this.findRow(id)) }

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
    this.insertMessage(id, 'assistant', name ? `${name}在。` : '我在。', nowStamp())
    return this.require(id)
  }

  async send(
    conversationId: string,
    text: string,
    onDelta?: (delta: string) => void,
    onStart?: () => void
  ): Promise<Result<Conversation>> {
    return this.inConversation(conversationId, () => this.sendTurn(conversationId, text, onDelta, onStart))
  }

  private async sendTurn(
    conversationId: string, text: string, onDelta?: (delta: string) => void, onStart?: () => void
  ): Promise<Result<Conversation>> {
    const existing = this.findRow(conversationId)
    if (!existing) return fail('会话不存在或已被清除')
    const userAt = nowStamp()
    const turnId = uid('msg')
    const route = routeUtterance(text)
    if (route.teammate !== 'chat') {
      onStart?.()
      let say = route.say
      let pose: StepPose = 'act'
      if (this.context.handleTeammate) {
        try {
          const handled = await this.context.handleTeammate(text, route)
          if (handled.say.trim()) say = handled.say.trim()
          if (handled.pose) pose = handled.pose
        } catch (error) {
          say = `这件事没交出去。${error instanceof Error ? error.message : '队友没有开始。'}`
          pose = 'fail'
        }
      }
      if (!this.findRow(conversationId)) return fail('会话不存在或已被清除')
      this.db.transaction(() => {
        this.insertMessage(conversationId, 'user', text, userAt)
        this.insertMessage(conversationId, 'assistant', say, nowStamp(), turnId)
        this.recordRecall(conversationId, turnId, [], [], 'not-used')
      })()
      const title = existing.title === '新的对话' ? text.slice(0, 24) : existing.title
      this.db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`).run(title, new Date().toISOString(), conversationId)
      notify(() => this.context.onTurn?.(text, conversationId))
      notify(() => this.context.onRecall?.(conversationId, { turnId, ids: [] }))
      notify(() => this.context.onReply?.(petSpeech(say), pose))
      return ok(this.require(conversationId))
    }
    const model = this.models.getDefault()
    const characterName = this.context.character?.().name
    if (!model) return fail(petLine(characterName, 'no-model'))
    if (!model.model.trim()) return fail('当前模型尚未填写模型名称，请到「模型服务」补全配置')
    if (!model.endpoint.trim()) return fail('当前模型尚未填写服务地址，请到「模型服务」补全配置')

    const history = this.messages(conversationId)
    const compacted = compactContext(
      text,
      history.map((message) => ({ id: message.id, evidence: message.text, role: message.role, time: message.created_at })),
      24
    )
    const recentIds = new Set(compacted.recent.map((step) => step.id))
    const messages: ChatTurn[] = history
      .filter((message) => recentIds.has(message.id))
      .map((message) => ({ role: message.role, content: message.text }))
    messages.push({ role: 'user', content: text })
    const character = this.context.character?.() ?? { name: '', style: '', example: '' }
    const relationship = this.context.relationship?.()
    const prompt = composePrompt(character, relationship?.stage)
    const memoryEnabled = this.context.memoryEnabled?.() ?? false
    let recalled: RecalledContext = { text: '', ids: [] }
    let recallUnavailable = memoryEnabled && !this.context.recall
    if (memoryEnabled && this.context.recall) {
      try { recalled = await this.context.recall(text) } catch {
        recallUnavailable = true
      }
    }
    const recallStatus: MemoryRecallStatus = !memoryEnabled || recalled.skipped === 'disabled' ? 'disabled'
      : recallUnavailable ? 'unavailable' : recalled.degraded || recalled.skipped === 'changed' ? 'limited' : 'complete'
    if (!this.findRow(conversationId)) return fail('会话不存在或已被清除')
    const earlier = compacted.summary ? `\n更早的对话记录摘录（保留来源角色；更正以较新的用户陈述为准，助手陈述不等于用户事实）：\n${compacted.summary}` : ''
    const voice = relationship ? `\n关系表达：${relationship.tone ?? ''} ${relationship.joke ?? ''}` : ''
    const memoryStatus = recallStatus === 'unavailable'
      ? '\n本轮长期记忆检索暂不可用；只能依据当前对话作答，不得声称已查到或不存在历史记忆。'
      : recallStatus === 'limited'
        ? '\n本轮长期记忆检索不完整或暂不可用；若提供了已检出的记忆，可继续参考，但可能遗漏其他相关记录。不得把未检出当作用户从未说过或没有这项偏好；缺少关键背景时应说明本轮无法确认，并向用户核实。'
        : ''
    const system = `${prompt.text}${voice}\n按用户需要给出完整、清楚的回答，详细说明和代码会保存在控制台。桌宠另行显示一句短话。不要自称人工智能或助手，不要声称已经操作了文件、命令或网页。${earlier}${memoryStatus}${recalled.text ? `\n可参考的长期记忆：\n${recalled.text}` : ''}`

    onStart?.()
    let reply: string
    const startedAt = Date.now()
    notify(() => this.context.onRecall?.(conversationId, { turnId, ids: [...recalled.ids] }))
    try {
      // 闲聊也不把模型原文一个字一个字流进气泡，等这一句完整回来。
      reply = await this.gateway.chat(model, messages, undefined, system)
      void onDelta
    } catch (error) {
      notify(() => this.models.markOffline(model.id, model))
      return fail(error instanceof Error ? error.message : '模型请求失败，请稍后重试')
    }
    if (!this.findRow(conversationId)) return fail('会话不存在或已被清除')
    if (!reply.trim()) return fail('模型返回了空内容，这次回复没有写入会话')
    try {
      this.db.transaction(() => {
        this.insertMessage(conversationId, 'user', text, userAt)
        this.insertMessage(conversationId, 'assistant', reply, nowStamp(), turnId)
        this.recordRecall(conversationId, turnId, recalled.ids, prompt.prompts, recallStatus)
      })()
    } catch { return fail('会话保存失败，这次回复未写入历史') }
    this.recordTrace(conversationId, [...messages.map((item) => String(item.content)), reply])
    const title = existing.title === '新的对话' ? text.slice(0, 24) : existing.title
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, new Date().toISOString(), conversationId)
    notify(() => this.models.markVerified(model.id, Date.now() - startedAt, model))
    notify(() => this.context.onTurn?.(text, conversationId))
    notify(() => this.context.onReply?.(petSpeech(reply)))
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
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id)
      this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM trace_nodes WHERE trace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM trace_blobs WHERE blob_hash NOT IN (SELECT blob_hash FROM trace_nodes)`).run()
      this.db.prepare(`DELETE FROM tool_calls WHERE task_id = ? AND tool_id = 'prompt'`).run(id)
    })()
    // 删除会话时同步释放该会话的请求队列，避免长期使用后 Map 只增不减。
    this.queues.delete(id)
    return this.list()
  }

  /** Last completed turn's actual injection IDs, including an explicitly empty set. */
  getRecall(conversationId: string): { turnId: string; ids: string[]; status: MemoryRecallStatus } | undefined {
    const row = this.db.prepare(`SELECT declared_json FROM tool_calls WHERE task_id = ? AND tool_id = 'prompt' ORDER BY created_at DESC, rowid DESC`).get(conversationId) as { declared_json: string } | undefined
    if (!row) return undefined
    try {
      const args = JSON.parse(row.declared_json).args
      const known: MemoryRecallStatus[] = ['complete', 'limited', 'unavailable', 'disabled', 'not-used', 'unknown']
      const status: MemoryRecallStatus = known.includes(args.memoryRecallStatus) ? args.memoryRecallStatus : 'unknown'
      return { turnId: args.turnId, ids: Array.isArray(args.memoryIds) ? args.memoryIds : [], status }
    } catch { return undefined }
  }

  /** 每条长期记忆最近一次被真实召回的来源；从未真正进入对话的记忆不会出现在结果里。 */
  recallSources(limit = 2000): MemoryRecallSource[] {
    const rows = this.db.prepare(
      `SELECT t.task_id AS conversationId, t.created_at AS at, t.declared_json AS declared, c.title AS title
         FROM tool_calls t LEFT JOIN conversations c ON c.id = t.task_id
        WHERE t.tool_id = 'prompt' AND t.declared_json LIKE '%"memoryIds"%'
        ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`
    ).all(limit) as RecallRow[]
    return collectRecallSources(rows)
  }

  /** Factual activity observations join the same serialized conversation timeline. */
  async appendObservation(conversationId: string, text: string): Promise<Result<Conversation>> {
    return this.inConversation(conversationId, async () => {
      if (!this.findRow(conversationId)) return fail('会话不存在或已被清除')
      if (!text.trim()) return fail('活动记录为空')
      this.insertMessage(conversationId, 'assistant', `活动记录：${text}`, nowStamp())
      this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(nowStamp(), conversationId)
      this.recordTrace(conversationId, this.messages(conversationId).map((message) => message.text))
      return ok(this.require(conversationId))
    })
  }

  private async inConversation<T>(id: string, job: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(id) ?? new RequestQueue()
    this.queues.set(id, queue)
    return queue.enqueue(job)
  }

  private recordRecall(conversationId: string, turnId: string, memoryIds: string[], prompts: Array<{ id: string; version: string }>, memoryRecallStatus: MemoryRecallStatus): void {
    const now = nowStamp()
    this.db.prepare(`INSERT INTO tool_calls(id, task_id, step_id, tool_id, declared_json, execution_json, verification_json, created_at, agent_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uid('call'), conversationId, 'prompt', 'prompt',
      JSON.stringify({ intent: 'system-prompt', args: { conversationId, turnId, prompts, memoryIds, memoryRecallStatus } }),
      JSON.stringify({ status: 'ok', raw: null, startedAt: now, endedAt: now }),
      JSON.stringify({ method: 'prompt-version', evidence: [], verdict: 'confirmed' }), now, 'prompt'
    )
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
        const scoped = (hash: string | null): string | null => hash ? `${conversationId}:${hash}` : null
        insertNode.run(scoped(node.seqHash), scoped(node.prevHash), node.blobHash, conversationId, `${conversationId}-${index}`, scoped(node.prevHash), now, now)
      })
    } catch {
      // 轨迹存储失败不影响已经写好的会话内容。
    }
  }

  clearCache(): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM activities`).run()
      this.db.prepare(`DELETE FROM trace_nodes`).run()
      this.db.prepare(`DELETE FROM trace_blobs`).run()
    })()
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

  private insertMessage(conversationId: string, role: 'user' | 'assistant', text: string, time: string, id = uid('msg')): void {
    this.db
      .prepare(
        `INSERT INTO messages(id, conversation_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, conversationId, role, text, time)
  }

  private hydrate(row: ConversationRow): Conversation {
    const messages = this.messages(row.id).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      time: displayTime(message.created_at)
    }))
    const recalled = this.getRecall(row.id)
    const preview = messages.at(-1)?.text.slice(0, 32).replace(/\n/g, ' ') ?? '从一个问题开始…'
    return clone({
      id: row.id,
      title: row.title,
      time: displayTime(row.updated_at),
      preview,
      count: messages.length,
      pinned: row.pinned === 1,
      messages,
      recalledMemoryIds: recalled?.ids ?? [],
      recalledAtMessageId: recalled?.turnId,
      memoryRecallStatus: recalled?.status
    })
  }
}
