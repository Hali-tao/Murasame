import type { SqliteDatabase } from '../../data/sqlite-types'
import type { CharacterProfile, Result } from '../../../shared/types'

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

const empty = (): CharacterProfile => ({
  name: '',
  style: '',
  example: '',
  keywords: [],
  proactive: false,
  memory: true
})

interface CharacterRow {
  name: string
  style: string
  example: string
  keywords_json: string
  proactive: number
  memory_enabled: number
}

export class CharacterService {
  constructor(private readonly db?: SqliteDatabase) {}

  load(): CharacterProfile {
    if (!this.db) return empty()
    try {
      const row = this.db.prepare(
        `SELECT name, style, example, keywords_json, proactive, memory_enabled FROM character_profile WHERE id = 1`
      ).get() as CharacterRow | undefined
      if (!row) return empty()
      return {
        name: row.name,
        style: row.style,
        example: row.example,
        keywords: JSON.parse(row.keywords_json) as string[],
        proactive: row.proactive === 1,
        memory: row.memory_enabled === 1
      }
    } catch {
      return empty()
    }
  }

  save(profile: CharacterProfile): Promise<Result<CharacterProfile>> {
    if (!profile.name.trim() || !profile.style.trim()) return Promise.resolve(fail('角色名称和交流风格不能为空'))
    if (!this.db) return Promise.resolve(fail('保存失败，修改未完成'))
    const now = new Date().toISOString()
    try {
      this.db.prepare(
        `INSERT INTO character_profile(id, name, style, example, keywords_json, proactive, memory_enabled, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           style = excluded.style,
           example = excluded.example,
           keywords_json = excluded.keywords_json,
           proactive = excluded.proactive,
           memory_enabled = excluded.memory_enabled,
           updated_at = excluded.updated_at`
      ).run(profile.name.trim(), profile.style.trim(), profile.example, JSON.stringify(profile.keywords), profile.proactive ? 1 : 0, profile.memory ? 1 : 0, now)
    } catch {
      return Promise.resolve(fail('保存失败，修改未完成'))
    }
    const saved = this.load()
    if (saved.name !== profile.name.trim()) return Promise.resolve(fail('保存失败，修改未完成'))
    return Promise.resolve(ok(saved))
  }
}
