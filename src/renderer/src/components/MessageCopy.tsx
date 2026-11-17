import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function MessageCopy({ text, role }: { text: string; role: string }): React.JSX.Element {
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null)
  const request = useRef(0)
  const label = role === 'assistant' ? '复制回复' : '复制消息'
  const copy = async (): Promise<void> => {
    const id = ++request.current
    try {
      await window.murasame.app.copyText(text)
      if (id === request.current) setResult({ text, ok: true })
    } catch {
      if (id === request.current) setResult({ text, ok: false })
    }
  }
  const current = result?.text === text ? result : null
  return <div className="message-copy-actions">
    <button type="button" className="message-copy-button" aria-label={label} title={label} onClick={() => void copy()}>
      {current?.ok ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span>{label}</span>
    </button>
    {current ? <span className="message-copy-feedback" role="status">{current.ok ? '已复制' : '复制失败，请重试'}</span> : null}
  </div>
}
