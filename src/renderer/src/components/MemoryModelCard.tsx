import { useEffect, useState } from 'react'
import type { MemoryModelStatus } from '@shared/types'
import { Button, Card, Pill } from './ui'

const labels = { missing: '未安装', preparing: '准备中', ready: '可用', error: '异常' }

export function MemoryModelCard({ enabled }: { enabled: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<MemoryModelStatus>({ state: 'preparing', message: '正在检查本地检索能力。' })
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let active = true
    void (async () => {
      try { const next = await window.murasame.app.checkMemoryModel(); if (active) setStatus(next) }
      catch { if (active) setStatus({ state: 'error', message: '无法检查模型状态，请重试。' }) }
      finally { if (active) setBusy(false) }
    })()
    return () => { active = false }
  }, [])

  const prepare = async (download: boolean): Promise<void> => {
    setBusy(true)
    setStatus({ state: 'preparing', message: download ? '正在下载、校验并测试模型，请稍候。' : '正在重新检查模型。' })
    try { setStatus(await (download ? window.murasame.app.installMemoryModel() : window.murasame.app.checkMemoryModel())) }
    catch { setStatus({ state: 'error', message: '准备失败，请检查网络或重试。已有记忆保留。' }) }
    finally { setBusy(false) }
  }

  return <Card className="memory-model-status" aria-label="记忆检索模型" data-testid="memory-model-status">
    <div className="banner-titleline"><strong>记忆检索模型</strong><Pill tone={status.state === 'ready' ? 'green' : status.state === 'preparing' ? 'blue' : 'amber'}>{labels[status.state]}</Pill></div>
    <p role="status">{status.message}</p>
    <p>{status.state !== 'ready'
      ? '仍可添加、查看、编辑和删除记忆，但暂时无法按意思找回相关记忆并带入聊天。保存成功不代表已被聊天使用。'
      : !enabled ? '长期记忆开关已关闭，当前不会提取或召回记忆。开启后才会使用检索能力。'
        : '检索在本机完成。选中的记忆会作为聊天上下文发送给你配置的模型服务，可在聊天的上下文面板查看实际使用记录。'}</p>
    <div className="editor-actions">
      {status.state !== 'ready' ? <Button disabled={busy} variant="primary" onClick={() => void prepare(true)}>{status.state === 'error' ? '重新下载修复' : '下载并准备模型'}</Button> : null}
      <Button disabled={busy} onClick={() => void prepare(false)}>重新检查</Button>
    </div>
    <p className="muted">下载约 25 MB，仅从 Hugging Face 获取模型文件，不上传记忆或对话。安装后检索无需联网；下载不会开启长期记忆开关。</p>
  </Card>
}
