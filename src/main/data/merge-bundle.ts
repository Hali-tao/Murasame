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
): { conversations: number; memories: number } {
  let conversations = 0
  let memories = 0
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
      for (const message of conversation.messages ?? []) {
        const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : ''
        const text = String(message.text ?? '').trim()
        if (!role || !text) continue
        const messageId = String(message.id ?? '').trim() || `msg-import-${id}-${conversations}-${text.slice(0, 12)}`
        insertMessage.run(messageId, id, role, text, message.time?.trim() || now)
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
  return { conversations, memories }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase().slice(0, 80)
}
