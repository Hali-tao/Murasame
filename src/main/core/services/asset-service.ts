import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

export interface AssetCheck {
  ok: boolean
  reason: string
}

export function validateCharacterDirectory(directory: string): AssetCheck {
  const names = existsSync(directory) ? readdirSync(directory) : []
  if (names.some((name) => name.endsWith('.moc') && !name.endsWith('.moc3'))) {
    return { ok: false, reason: '不支持 Cubism 2.1 的 .moc 资源' }
  }
  const model = names.find((name) => name.endsWith('.model3.json'))
  if (!model) return { ok: false, reason: '缺少 model3.json' }
  if (!names.some((name) => name.endsWith('.moc3'))) return { ok: false, reason: '缺少 moc3' }
  const description = JSON.parse(readFileSync(join(directory, model), 'utf8')) as { FileReferences?: { Textures?: string[] } }
  const textures = description.FileReferences?.Textures ?? []
  if (textures.length === 0 || textures.some((texture) => !existsSync(join(directory, texture)))) {
    return { ok: false, reason: '贴图缺失，原有角色保持不变' }
  }
  return { ok: true, reason: '资源可以加载' }
}

export interface ImportedCharacter {
  ok: boolean
  reason: string
  id: string
  modelUrl: string
}

function directoryWithModel(directory: string): string {
  const names = readdirSync(directory)
  if (names.some((name) => name.endsWith('.model3.json') || (name.endsWith('.moc') && !name.endsWith('.moc3')))) return directory
  const nested = names
    .map((name) => join(directory, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    })
  if (nested.length === 1) return directoryWithModel(nested[0])
  return directory
}

function unzip(source: string, destination: string): boolean {
  const script = `Expand-Archive -LiteralPath $env:MURASAME_ZIP -DestinationPath $env:MURASAME_UNZIP -Force`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MURASAME_ZIP: source, MURASAME_UNZIP: destination },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 20000
  })
  return result.status === 0
}

export function importCharacterDirectory(source: string, destRoot: string): ImportedCharacter {
  const failed = (reason: string): ImportedCharacter => ({ ok: false, reason, id: '', modelUrl: '' })
  if (!existsSync(source)) return failed('找不到要导入的目录或压缩包，原有角色保持不变')
  let staging = source
  let temporary: string | null = null
  if (source.toLowerCase().endsWith('.zip')) {
    temporary = mkdtempSync(join(tmpdir(), 'murasame-live2d-'))
    if (!unzip(source, temporary)) {
      rmSync(temporary, { recursive: true, force: true })
      return failed('压缩包无法解压，原有角色保持不变')
    }
    staging = directoryWithModel(temporary)
  }
  const check = validateCharacterDirectory(staging)
  if (!check.ok) {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
    return failed(`${check.reason}。原有角色保持不变`)
  }
  const id = `char-${Date.now()}`
  const destination = join(destRoot, id)
  cpSync(staging, destination, { recursive: true })
  if (temporary) rmSync(temporary, { recursive: true, force: true })
  const model = readdirSync(destination).find((name) => name.endsWith('.model3.json'))
  if (!model) {
    rmSync(destination, { recursive: true, force: true })
    return failed('缺少 model3.json。原有角色保持不变')
  }
  return { ok: true, reason: '资源可以加载', id, modelUrl: `characters/${id}/${model}` }
}
