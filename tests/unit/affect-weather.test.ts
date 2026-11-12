import { describe, expect, it } from 'vitest'
import { affectWeather } from '../../src/shared/avatar/affect-weather'
import { baselinePad } from '../../src/shared/avatar/pad'

const pad = (pleasure: number, arousal: number, dominance = 0) => ({ pleasure, arousal, dominance })

describe('[FR-EMO-00] 情绪天气的定性映射（F-03 切片）', () => {
  it('[FR-EMO-01] 基线与平静状态显示「多云转晴」，不给数值', () => {
    const weather = affectWeather(baselinePad())
    expect(weather.key).toBe('steady')
    expect(weather.label).toBe('多云转晴')
    expect(weather.sentence).not.toMatch(/\d/)
    expect(weather.caption).not.toMatch(/\d/)
  })

  it('[FR-EMO-02] 明显正向情绪显示「晴」', () => {
    expect(affectWeather(pad(0.4, 0.3)).key).toBe('bright')
    // 轻微愉悦但明显兴奋也算晴
    expect(affectWeather(pad(0.12, 0.4)).key).toBe('bright')
  })

  it('[FR-EMO-03] 明显负向情绪显示「小雨」，不索取安慰', () => {
    const weather = affectWeather(pad(-0.4, 0.1))
    expect(weather.key).toBe('low')
    expect(weather.caption).toContain('不会用情绪向你提要求')
  })

  it('[FR-EMO-04] 高唤醒但情绪不差时显示「起风」', () => {
    expect(affectWeather(pad(0, 0.6)).key).toBe('tense')
  })

  it('[FR-EMO-05] 所有天气文案都不包含数值，也不推断具体原因', () => {
    const samples = [pad(0.9, 0.9), pad(-0.9, -0.9), pad(0.2, 0.8), baselinePad(), pad(0, 0.4)]
    for (const sample of samples) {
      const weather = affectWeather(sample)
      const text = `${weather.label}${weather.sentence}${weather.caption}`
      expect(text).not.toMatch(/\d/)
      expect(text).not.toMatch(/因为|由于|因为你/)
      expect(['bright', 'steady', 'low', 'tense']).toContain(weather.key)
    }
  })
})
