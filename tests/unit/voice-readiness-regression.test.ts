import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const external = vi.hoisted(() => ({ run: vi.fn(), missingStt: vi.fn(() => [] as string[]), missingTts: vi.fn(() => [] as string[]) }))
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: external.run }) }))
vi.mock('../../src/main/local/stt', () => ({ missingWhisperFiles: external.missingStt, transcribeAudio: vi.fn() }))
vi.mock('../../src/main/local/tts', () => ({ missingKokoroFiles: external.missingTts, synthesizeChinese: vi.fn() }))
import { VoiceService } from '../../src/main/core/services/voice-service'
import { phonemizeChinese } from '../../src/main/local/phonemize'

beforeEach(() => {
  external.run.mockReset()
  external.run.mockResolvedValue({ stdout: 'ni xau', stderr: '' })
  external.missingStt.mockReturnValue([]); external.missingTts.mockReturnValue([])
})

afterEach(() => { vi.unstubAllEnvs() })

describe('voice readiness checks executable dependencies honestly', () => {
  it('does not report TTS ready solely because model files exist', async () => {
    vi.stubEnv('MURASAME_PYTHON', 'missing-python-readiness')
    external.run.mockRejectedValue(new Error('ENOENT Python unavailable'))
    const ready = await new VoiceService('synthetic').readiness()
    expect(ready.tts).toBe(false)
    expect(ready.stt).toBe(true)
    expect(ready.detail).toContain('音素')
    expect(ready.detail).toContain('尚待录音测试')
  })

  it('deduplicates concurrent real phoneme probes and caches successful checks', async () => {
    vi.stubEnv('MURASAME_PYTHON', 'available-python-readiness')
    const service = new VoiceService('synthetic')
    const [a, b] = await Promise.all([service.readiness(), service.readiness()])
    expect(a.tts).toBe(true); expect(b.tts).toBe(true)
    await service.readiness()
    expect(external.run).toHaveBeenCalledTimes(1)
    const args = external.run.mock.calls[0]
    expect(args[0]).toBe('available-python-readiness')
    expect(args[1][1]).toContain('from misaki import zh')
    expect(args[1][2]).toContain('你好')
    expect(a.detail).toContain('尚待录音测试')
    expect(a.detail).toContain('尚待试听')
  })

  it('rechecks a changed interpreter instead of reusing readiness for another environment', async () => {
    vi.stubEnv('MURASAME_PYTHON', 'ready-python-first')
    const service = new VoiceService('synthetic')
    expect((await service.readiness()).tts).toBe(true)
    vi.stubEnv('MURASAME_PYTHON', 'missing-misaki-second')
    external.run.mockRejectedValue(new Error('No module named misaki'))
    expect((await service.readiness()).tts).toBe(false)
    expect(external.run).toHaveBeenCalledTimes(2)
  })

  it('checks explicit interpreter selection without relying on a machine-specific path', async () => {
    vi.stubEnv('MURASAME_PYTHON', 'user-selected-python')
    await phonemizeChinese('测试')
    expect(external.run.mock.calls[0][0]).toBe('user-selected-python')
    expect(external.run.mock.calls[0][2]).toMatchObject({ windowsHide: true, timeout: 20_000 })
  })
})
