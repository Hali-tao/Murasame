import { useEffect, useState } from 'react'
import type { DailyRecap } from '@shared/types'
import { Card, CardHead } from './ui'

/** F-02 每日回顾（事实版）：只汇总真实发生的事，不做评分/打卡，不调用模型。 */
export function DailyRecapCard(): React.JSX.Element {
  const [recap, setRecap] = useState<DailyRecap | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.murasame.core
      .dailyRecap()
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setFailed(true)
          return
        }
        setFailed(false)
        setRecap(result.data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <Card className="daily-recap-card" data-testid="daily-recap">
      <CardHead title="今天" subtitle="只汇总真实发生的事，不做评分或打卡" />
      {failed ? (
        <p className="muted" data-testid="daily-recap-failed">回顾暂时读不到，稍后会再试。回顾只读本地数据库。</p>
      ) : !recap ? (
        <p className="muted">正在整理今天…</p>
      ) : !recap.hasActivity ? (
        <p className="muted" data-testid="daily-recap-empty">今天还没有可回顾的记录。去聊两句或记下一条偏好，回顾只从真实事实里长出来。</p>
      ) : (
        <ul className="recap-list" data-testid="daily-recap-facts">
          {recap.messages > 0 ? <li><span>聊了</span><strong>{recap.messages} 句</strong><small>{recap.conversations} 个会话</small></li> : null}
          {recap.memoriesAdded > 0 ? <li><span>新记住</span><strong>{recap.memoriesAdded} 条</strong></li> : null}
          {recap.memoryRecalls > 0 ? <li><span>回忆被真正带进对话</span><strong>{recap.memoryRecalls} 次</strong></li> : null}
          {recap.tasksCompleted + recap.tasksFailed + recap.tasksActive + recap.tasksCancelled > 0 ? (
            <li>
              <span>任务</span>
              <strong>完成 {recap.tasksCompleted} · 失败 {recap.tasksFailed} · 进行中 {recap.tasksActive}</strong>
              {recap.tasksCancelled > 0 ? <small>取消 {recap.tasksCancelled}</small> : null}
            </li>
          ) : null}
          <li className="muted"><small>回顾来自本地数据库，不调用模型；读取失败会如实显示失败，不编造。</small></li>
        </ul>
      )}
    </Card>
  )
}
