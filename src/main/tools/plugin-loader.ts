import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

export interface PluginManifest {
  id: string
  name: string
  ability: string
  sensitive: boolean
  entry: string
  parameters: Record<string, unknown>
}

export function readPluginManifest(raw: string): { ok: true; manifest: PluginManifest } | { ok: false; reason: string } {
  try {
    const value = JSON.parse(raw) as Partial<PluginManifest>
    if (!value.id || !value.name || !value.entry) return { ok: false, reason: '插件清单缺少 id、名称或入口文件' }
    return {
      ok: true,
      manifest: {
        id: value.id,
        name: value.name,
        ability: value.ability ?? '',
        sensitive: Boolean(value.sensitive),
        entry: value.entry,
        parameters: value.parameters ?? { type: 'object' }
      }
    }
  } catch {
    return { ok: false, reason: '插件清单不是有效的 JSON' }
  }
}

export function loadPluginDirectory(directory: string): { plugins: PluginManifest[]; errors: string[] } {
  const plugins: PluginManifest[] = []
  const errors: string[] = []
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return { plugins, errors }
  }
  for (const name of names) {
    const folder = join(directory, name)
    try {
      if (!statSync(folder).isDirectory()) continue
      const manifest = readPluginManifest(readFileSync(join(folder, 'plugin.json'), 'utf8'))
      if (!manifest.ok) {
        errors.push(`${name}: ${manifest.reason}`)
        continue
      }
      plugins.push(manifest.manifest)
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : '无法读取插件'}`)
    }
  }
  return { plugins, errors }
}

export function runPlugin(entryPath: string): { ok: true; raw: string } | { ok: false; reason: string } {
  try {
    const code = readFileSync(entryPath, 'utf8')
    const sandbox: { result?: unknown } = {}
    runInNewContext(`${code}\n;result = typeof run === 'function' ? run() : null`, sandbox, { timeout: 1000 })
    return { ok: true, raw: JSON.stringify(sandbox.result ?? null) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '插件运行失败' }
  }
}
