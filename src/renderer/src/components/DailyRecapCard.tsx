import { useEffect, useRef, useState } from 'react'
import type { DailyRecap } from '@shared/types'
import { useAppStore } from '../store'
import { Card, CardHead } from './ui'

/** F-02 每日回顾（事实版）：只汇总真实发生的事，不做评分/打卡，不调用模型。 */
export function DailyRecapCard(): React.JSX.Element {
  const [recap, setRecap] = useState<DailyRecap | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteStatus, setNoteStatus] = useState<'idle' | 'saved' | 'failed'>('idle')
  // 用户正在输入但未保存时，自动刷新不得把草稿覆盖成已保存内容。
  const noteDirtyRef = useRef(false)
  const memoriesCount = useAppStore((state) => state.data?.memories.length ?? 0)
  const tasksCount = useAppStore((state) => state.data?.tasks.length ?? 0)
  const conversationsCount = useAppStore((state) => state.data?.conversations.length ?? 0)
  const messagesCount = useAppStore((state) => state.data?.conversations.reduce((sum, item) => sum + item.messages.length, 0) ?? 0)
  // 记忆/任务/会话/消息数变化时自动刷新回顾，不必等 30 秒轮询或重新挂载页面
  // （桌宠聊天与控制台同时打开时，消息数不会改变会话条数，必须单独作为刷新信号）。
  const refreshSignal = `${memoriesCount}:${tasksCount}:${conversationsCount}:${messagesCount}`

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
        if (!noteDirtyRef.current) setNoteDraft(result.data.userNote ?? '')
        setNoteStatus('idle')
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [tick, refreshSignal])

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const saveNote = async (): Promise<void> => {
    if (!recap || noteSaving) return
    setNoteSaving(true)
    setNoteStatus('idle')
    try {
      const result = await window.murasame.core.saveRecapNote(noteDraft)
      if (!result.ok) {
        setNoteStatus('failed')
        return
      }
      noteDirtyRef.current = false
      setNoteDraft(result.data)
      setRecap((previous) => (previous ? { ...previous, userNote: result.data } : previous))
      setNoteStatus('saved')
    } catch {
      setNoteStatus('failed')
    } finally {
      setNoteSaving(false)
    }
  }

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
      {recap && !failed ? (
        <details className="recap-note" data-testid="recap-note">
          <summary>留给明天的一句话</summary>
          <label className="sr-only" htmlFor="recap-note-input">留给明天的一句话</label>
          <textarea
            id="recap-note-input"
            data-testid="recap-note-input"
            rows={2}
            maxLength={200}
            value={noteDraft}
            placeholder="只保存在本机，不评分、不会上传。"
            onChange={(event) => {
              noteDirtyRef.current = true
              setNoteDraft(event.target.value)
              setNoteStatus('idle')
            }}
            disabled={noteSaving}
          />
          <div className="recap-note-foot">
            <button
              type="button"
              className="btn"
              data-testid="recap-note-save"
              disabled={noteSaving || noteDraft.trim() === (recap.userNote ?? '').trim()}
              onClick={() => void saveNote()}
            >
              {noteSaving ? '保存中…' : '保存'}
            </button>
            {noteStatus === 'saved' ? <span className="muted small" data-testid="recap-note-status">已留给明天，只保存在本机。</span> : null}
            {noteStatus === 'failed' ? <span className="muted small" data-testid="recap-note-status">保存失败，稍后再试；内容不会上传。</span> : null}
            <span className="muted small">{noteDraft.length}/200</span>
          </div>
        </details>
      ) : null}
    </Card>
  )
}
