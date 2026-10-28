import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const run = promisify(execFile)

const script = [
  'import sys, io',
  'sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")',
  'from misaki import zh',
  'g = zh.ZHG2P()',
  'ps, _ = g(sys.argv[1])',
  'sys.stdout.write(ps)'
].join('\n')

export class PhonemizerUnavailable extends Error {
  constructor(detail: string) {
    super(`中文音素转换不可用：${detail}`)
    this.name = 'PhonemizerUnavailable'
  }
}

/** 汉字转音素只做这一步，推理仍在本进程内完成。 */
export async function phonemizeChinese(
  text: string,
  interpreter = chinesePythonInterpreter()
): Promise<string> {
  try {
    const { stdout } = await run(interpreter, ['-c', script, text.slice(0, 400)], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      timeout: 20_000,
      windowsHide: true
    })
    const phonemes = stdout.trim()
    if (!phonemes) throw new PhonemizerUnavailable('没有返回音素')
    return phonemes
  } catch (error) {
    if (error instanceof PhonemizerUnavailable) throw error
    throw new PhonemizerUnavailable(error instanceof Error ? error.message : '调用失败')
  }
}

/** Match the installer location, while honoring an explicit user environment first. */
export function chinesePythonInterpreter(): string {
  const explicit = process.env.MURASAME_PYTHON?.trim()
  if (explicit) return explicit
  if (process.env.VIRTUAL_ENV) {
    const virtual = join(process.env.VIRTUAL_ENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    if (existsSync(virtual)) return virtual
  }
  if (process.env.LOCALAPPDATA) {
    const embedded = join(process.env.LOCALAPPDATA, 'Murasame', 'python', 'python.exe')
    if (existsSync(embedded)) return embedded
  }
  return 'python'
}

interface PhonemizerProbe { ready: boolean; detail: string }
const probes = new Map<string, { expiresAt: number; result: Promise<PhonemizerProbe> }>()

/** A real conversion verifies Python, misaki imports, and its Chinese resources.
 * Concurrent callers share the probe; failures expire sooner so repair is detected.
 */
export function probeChinesePhonemizer(): Promise<PhonemizerProbe> {
  const interpreter = chinesePythonInterpreter()
  const cached = probes.get(interpreter)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  const entry = { expiresAt: Date.now() + 60_000, result: Promise.resolve({ ready: false, detail: '' }) }
  entry.result = phonemizeChinese('你好，准备朗读。', interpreter).then(() => ({ ready: true, detail: '中文音素转换已验证' })).catch((error) => {
    entry.expiresAt = Date.now() + 10_000
    return { ready: false, detail: error instanceof Error ? error.message : '中文音素转换不可用' }
  })
  probes.set(interpreter, entry)
  return entry.result
}
