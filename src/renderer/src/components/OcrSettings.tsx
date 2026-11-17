import { useEffect, useState } from 'react'
import type { OcrModelStatus } from '@shared/types'
import { Button, Card, CardHead, Pill, Spinner } from './ui'

const stateLabel: Record<OcrModelStatus['state'], string> = {
  missing: '未安装', installed: '已安装 · 待加载', installing: '正在安装', loading: '正在加载', ready: '可用', failed: '失败 · 使用备用'
}

export function OcrSettings(): React.JSX.Element {
  const [status, setStatus] = useState<OcrModelStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async (): Promise<void> => {
      if (pending) return
      pending = true
      try { const value = await window.murasame.app.ocrStatus(); if (active) setStatus(value) }
      catch { if (active) setError('无法读取 OCR 状态，请重试。') }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const act = async (install: boolean): Promise<void> => {
    setBusy(true); setError('')
    try { setStatus(await (install ? window.murasame.app.installOcrModel() : window.murasame.app.checkOcrModel())) }
    catch { setError('操作未完成，请检查网络或稍后重试。') }
    finally { setBusy(false) }
  }
  const working = busy || status?.state === 'installing' || status?.state === 'loading'
  return <Card className="ocr-settings" data-testid="ocr-settings">
    <CardHead title="本地文字识别" subtitle="PP-OCRv5 轻量模型 · 安装后在本机离线识别"
      aside={<Pill tone={status?.state === 'ready' ? 'green' : 'gray'}>{status ? stateLabel[status.state] : '正在检查'}</Pill>} />
    <div className="about-list ocr-paths">
      <div><span>识别引擎</span><strong>{status?.engine === 'ppocrv5' ? '优先使用 PP-OCRv5，Windows OCR 备用' : 'Windows OCR 备用；PP-OCRv5 就绪后优先使用'}</strong></div>
      <div><span>安装位置</span><strong>{status?.directory || '正在读取'}</strong></div>
    </div>
    <p className="muted" role="status">{error || status?.detail}</p>
    {working && <div className="ocr-install-progress"><Spinner size={14} /><progress aria-label="OCR 安装进度" max={100} value={status?.progress ?? 0} /><span>{status?.progress ?? 0}%</span></div>}
    <p className="fineprint">首次安装需联网下载约 {status ? Math.ceil(status.downloadBytes / 1024 / 1024) : 142} MB 的模型和独立运行组件。安装后 OCR 识别不联网；屏幕辅助会将识别文字发送给当前大模型分析，截图留在本机。更改数据位置后，OCR 文件会随数据一起迁移。</p>
    <div className="ocr-settings-actions">
      <Button onClick={() => void act(true)} disabled={working || !status}>{status?.state === 'missing' ? '安装 OCR 模型' : '重新安装 OCR 模型'}</Button>
      <Button onClick={() => void act(false)} disabled={working || !status || status.state === 'missing'}>检查 OCR 模型</Button>
    </div>
  </Card>
}
