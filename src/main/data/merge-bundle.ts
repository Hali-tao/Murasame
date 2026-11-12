import type { SqliteDatabase } from './sqlite-types'

export interface PortableConversation {
  id?: string
  title?: string
  pinned?: boolean
  messages?: Array<{ id?: string; role?: string; text?: string; time?: string }>
}

export interface PortableMemory {
  id?: string
  category?: string
  text?: string
}

export function mergeImportedBundle(
  db: SqliteDatabase,
  input: { conversations?: PortableConversation[]; memories?: PortableMemory[] }
): { conversations: number; memories: number; skippedMessages: number } {
  let conversations = 0
  let memories = 0
  let skippedMessages = 0
  const now = new Date().toISOString()
  const apply = db.transaction(() => {
    const insertConversation = db.prepare(
      `INSERT OR IGNORE INTO conversations(id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    )
    const insertMessage = db.prepare(
      `INSERT OR IGNORE INTO messages(id, conversation_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    const memoryExists = db.prepare(`SELECT id FROM memories WHERE text = ?`)
    const insertMemory = db.prepare(
      `INSERT OR IGNORE INTO memories(id, category, text, source, created_at, updated_at, normalized_key) VALUES (?, ?, ?, '导入', ?, ?, ?)`
    )
    for (const conversation of input.conversations ?? []) {
      const id = String(conversation.id ?? '').trim()
      if (!id) continue
      const inserted = insertConversation.run(id, conversation.title?.trim() || '导入的对话', conversation.pinned ? 1 : 0, now, now)
      if (inserted.changes > 0) conversations += 1
      let messageIndex = 0
      for (const message of conversation.messages ?? []) {
        messageIndex += 1
        const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : ''
        const text = String(message.text ?? '').trim()
        if (!role || !text) continue
        // 回退 ID 必须包含对话内序号：只看正文前缀会让「好的，我明白了……」这类同前缀消息
        // 生成同一个 ID，被 INSERT OR IGNORE 静默丢弃。
        const messageId = String(message.id ?? '').trim() || `msg-import-${id}-${messageIndex}-${hashText(text)}`
        const result = insertMessage.run(messageId, id, role, text, message.time?.trim() || now)
        if (result.changes === 0) skippedMessages += 1
      }
    }
    for (const memory of input.memories ?? []) {
      const text = String(memory.text ?? '').trim()
      if (!text || memoryExists.get(text)) continue
      const id = String(memory.id ?? '').trim() || `mem-import-${normalize(text)}`
      const inserted = insertMemory.run(id, memory.category?.trim() || '偏好', text, now, now, normalize(text))
      if (inserted.changes > 0) memories += 1
    }
  })
  apply()
  return { conversations, memories, skippedMessages }
}

function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase().slice(0, 80)
}
