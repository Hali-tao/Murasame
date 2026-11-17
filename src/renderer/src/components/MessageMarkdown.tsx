import { createContext, memo, useContext, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const Streaming = createContext(false)

function CodeBlock({ text, language }: { text: string; language: string }): React.JSX.Element {
  const streaming = useContext(Streaming)
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null)
  const request = useRef(0)
  const copy = async (): Promise<void> => {
    const id = ++request.current
    try {
      await window.murasame.app.copyText(text)
      if (id === request.current) setResult({ text, ok: true })
    } catch {
      if (id === request.current) setResult({ text, ok: false })
    }
  }
  return <div className="markdown-code-block">
    <div className="markdown-code-toolbar">
      <span>{language || '代码'}{streaming ? ' · 正在输出' : ''}</span>
      <button type="button" onClick={() => void copy()}>复制代码</button>
    </div>
    <pre tabIndex={0}><code>{text}</code></pre>
    <span className="markdown-copy-status" role="status">{result?.text === text ? result.ok ? (streaming ? '已复制当前片段' : '已复制') : '复制失败，请重试或手动选择代码。' : ''}</span>
  </div>
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }): React.JSX.Element {
  const streaming = useContext(Streaming)
  let safe = false
  try { const url = new URL(href || ''); safe = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { /* Incomplete or internal URLs remain text. */ }
  return safe && !streaming ? <a href={href} target="_blank" rel="noopener noreferrer" title={href}>{children}</a> : <span>{children}</span>
}

const components: Components = {
  pre({ node, children }) {
    const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code')
    if (!code || code.type !== 'element') return <pre>{children}</pre>
    // remark adds one display newline to code; remove only that synthetic newline, never trim source whitespace.
    const text = code.children.map(child => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '')
    const classes = Array.isArray(code.properties.className) ? code.properties.className.map(String) : []
    const language = classes.find(value => value.startsWith('language-'))?.slice(9) ?? ''
    return <CodeBlock text={text} language={language} />
  },
  a: MarkdownLink,
  // Remote images must not silently send a request just because a message was displayed.
  img({ alt }) { return <span className="markdown-image-note">[图片：{alt || '未加载'}]</span> },
  table({ children }) { return <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="消息表格"><table>{children}</table></div> }
}

/** Formatting is display-only. The original text remains available and is never rewritten for streaming. */
export const MessageMarkdown = memo(function MessageMarkdown({ text, streaming = false, showSource = true }: { text: string; streaming?: boolean; showSource?: boolean }): React.JSX.Element {
  const [sourceOpen, setSourceOpen] = useState(false)
  return <Streaming.Provider value={streaming}>
    <div className="message-markdown" data-streaming={streaming || undefined}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown>
    </div>
    {showSource ? <div className="message-source"><button type="button" aria-expanded={sourceOpen} onClick={() => setSourceOpen(value => !value)}>{sourceOpen ? '收起原文' : '查看原文'}</button>{sourceOpen ? <pre>{text}</pre> : null}</div> : null}
  </Streaming.Provider>
})
