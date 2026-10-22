import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
  interpreter = process.env.MURASAME_PYTHON || 'python'
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
