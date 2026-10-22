import { join } from 'node:path'
import type { SqliteDatabase } from '../../data/sqlite-types'
import { availability } from '../../tools/types'
import { loadPluginDirectory } from '../../tools/plugin-loader'
import { ToolRegistry } from '../../tools/registry'
import { readToolEnabled, writeToolEnabled } from '../../settings'
import type { Result, ToolCapability } from '../../../shared/types'

const unavailable = new Set(['obsidian', 'calendar'])

export class ToolService {
  private readonly registry = new ToolRegistry()

  constructor(private readonly db?: SqliteDatabase) {
    for (const [id, enabled] of Object.entries(readToolEnabled())) {
      try {
        this.registry.setEnabled(id, enabled)
      } catch {
        // 旧记录里的工具已经不在列表中时忽略。
      }
    }
  }

  list(): ToolCapability[] {
    return this.registry.list().map((tool) => {
      const state = availability(tool)
      const blocked = unavailable.has(tool.id)
      return {
        id: tool.id,
        name: tool.name,
        kind: tool.kind,
        ability: tool.ability,
        permission: blocked ? '不可用' : tool.enabled ? (tool.sensitive ? '需确认' : '可调用') : '已停用',
        enabled: blocked ? false : tool.enabled,
        last: this.lastUsed(tool.id),
        note: blocked
          ? '尚未实现，不会显示为可用'
          : tool.running && !tool.enabled
            ? '不再接受新调用，进行中的操作仍单独显示'
            : state.note
      }
    })
  }

  loadDirectory(directory: string): string[] {
    const loaded = loadPluginDirectory(directory)
    for (const plugin of loaded.plugins) {
      this.registry.register({
        id: plugin.id,
        name: plugin.name,
        kind: '插件',
        ability: plugin.ability,
        parameters: plugin.parameters,
        sensitive: plugin.sensitive,
        enabled: false,
        running: false
      })
    }
    return loaded.errors
  }

  bundledDirectory(appPath: string): string {
    return join(appPath, 'plugins')
  }

  setEnabled(id: string, enabled: boolean): Promise<Result<ToolCapability>> {
    if (unavailable.has(id)) return Promise.resolve({ ok: false, error: '该能力尚未实现，不能启用' })
    try {
      const tool = this.registry.setEnabled(id, enabled)
      writeToolEnabled(id, enabled)
      const listed = this.list().find((item) => item.id === tool.id)
      if (!listed) return Promise.resolve({ ok: false, error: '能力不存在' })
      return Promise.resolve({ ok: true, data: listed })
    } catch (error) {
      return Promise.resolve({ ok: false, error: error instanceof Error ? error.message : '能力不存在' })
    }
  }

  assertCallable(id: string): void {
    this.registry.assertCallable(id)
  }

  private lastUsed(id: string): string {
    if (!this.db) return ''
    try {
      const row = this.db.prepare(
        `SELECT created_at FROM tool_calls WHERE tool_id = ? ORDER BY created_at DESC LIMIT 1`
      ).get(id) as { created_at?: string } | undefined
      return row?.created_at ?? ''
    } catch {
      return ''
    }
  }
}
