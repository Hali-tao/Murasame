import { useEffect, useState } from 'react'
import type { AffectEvent, PerformanceCue } from '@shared/types'
import { affectWeather } from '@shared/avatar/affect-weather'
import { Card, CardHead, Pill } from './ui'

const TONE: Record<string, 'green' | 'amber' | 'blue'> = {
  bright: 'green',
  steady: 'green',
  low: 'blue',
  tense: 'amber'
}

/**
 * F-03 情绪天气切片：只展示定性状态与「发生了什么」，
 * 不显示 PAD 数值、不推断用户动机、不索取安慰。
 */
export function AffectWeatherCard(): React.JSX.Element {
  const [pad, setPad] = useState<PerformanceCue['pad'] | null>(null)
  const [events, setEvents] = useState<AffectEvent[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const read = (): void => {
      void Promise.all([window.murasame.pet.getAffect(), window.murasame.pet.getAffectEvents()])
        .then(([value, history]) => {
          if (cancelled) return
          setPad(value)
          setEvents(history)
          setFailed(false)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    }
    read()
    const timer = window.setInterval(read, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const weather = pad ? affectWeather(pad) : null
  return (
    <Card className="affect-weather-card" data-testid="affect-weather">
      <CardHead title="它现在的心情" subtitle="只显示状态，不显示数值，也不推断原因" />
      {failed ? (
        <p className="muted">暂时读不到心情，稍后会再试。</p>
      ) : !weather ? (
        <p className="muted">正在看它的状态…</p>
      ) : (
        <>
          <div className="affect-weather-line" data-testid="affect-weather-label">
            <Pill tone={TONE[weather.key] ?? 'green'}>{weather.label}</Pill>
          </div>
          <p data-testid="affect-weather-sentence">{weather.sentence}</p>
          <p className="muted small">{weather.caption}</p>
          {events === null ? (
            <p className="muted small">正在整理情绪记录…</p>
          ) : events.length ? (
            <p className="muted small" data-testid="affect-weather-reason">刚刚：{events[0].reason}。只记录发生了什么，不猜你的动机。</p>
          ) : (
            <p className="muted small" data-testid="affect-weather-reason">还没有值得解释的情绪变化。</p>
          )}
        </>
      )}
    </Card>
  )
}
