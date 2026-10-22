import { Pin, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DeleteScope } from '@shared/types'
import { ClearScopeDialog } from '../components/dialogs'
import { Button, Card, CardHead, EmptyState, Pill } from '../components/ui'
import { useAppStore } from '../store'

export function HistoryPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const selectedId = useAppStore((state) => state.selectedConversationId)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const deleteConversation = useAppStore((state) => state.deleteConversation)
  const notify = useAppStore((state) => state.notify)
  const busy = useAppStore((state) => Boolean(state.busy['history:delete']))
  const [search, setSearch] = useState('')
  const [clearOpen, setClearOpen] = useState(false)

  const filtered = data.conversations.filter((conversation) =>
    `${conversation.title}${conversation.preview}${conversation.time}`.toLowerCase().includes(search.trim().toLowerCase())
  )
  const selected = data.conversations.find((item) => item.id === selectedId) ?? filtered[0] ?? data.conversations[0]

  useEffect(() => {
    if (!selectedId && data.conversations[0]) selectConversation(data.conversations[0].id)
  }, [selectedId, data.conversations, selectConversation])

  const clear = async (scopes: DeleteScope[]): Promise<void> => {
    if (!selected) return
    try {
      if (scopes.includes('logs')) await window.murasame.app.clearLogs()
      if (scopes.includes('history')) {
        await deleteConversation(selected.id, scopes)
      } else {
        notify('已清除所选范围；会话正文仍保留', 'gray')
      }
      setClearOpen(false)
    } catch {
      notify('清除操作未完成，请检查本地权限', 'red')
    }
  }

  return (
    <div className="page history-page">
      <div className="history-layout">
        <Card className="history-list-card">
          <CardHead title="本地会话" subtitle="只保存在此设备 · 加密存储" aside={<Pill tone="gray">{data.conversations.length} 个会话</Pill>} />
          <div className="search-box">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、内容或日期…" aria-label="搜索历史" />
          </div>
          <div className="history-list">
            {filtered.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                data-testid="history-item"
                className={`history-item${conversation.id === selected?.id ? ' active' : ''}`}
                onClick={() => selectConversation(conversation.id)}
              >
                <div className="history-item-top">
                  <strong>{conversation.title}</strong>
                  <time>{conversation.time}</time>
                </div>
                <p>{conversation.preview}</p>
                <div className="history-item-foot">
                  <span>{conversation.count} 条消息</span>
                  {conversation.pinned ? <Pill tone="coral"><Pin size={10} />置顶</Pill> : null}
                </div>
              </button>
            ))}
            {!filtered.length ? <EmptyState title="没有匹配的会话" description="试试标题、正文中的关键词或日期。" /> : null}
          </div>
        </Card>

        <Card className="history-detail-card">
          {selected ? (
            <>
              <div className="history-detail-head">
                <div>
                  <div className="history-badges"><Pill tone="gray">本地会话</Pill><span>{selected.time}</span></div>
                  <h2>{selected.title}</h2>
                  <p>{selected.messages.length} 条消息 · 仅此设备可读</p>
                </div>
                <Button variant="danger" size="sm" onClick={() => setClearOpen(true)} icon={<Trash2 size={14} />} data-testid="clear-history">
                  清除…
                </Button>
              </div>
              <div className="history-messages">
                {selected.messages.map((message) => (
                  <div className={`message-row ${message.role}`} key={message.id}>
                    {message.role === 'assistant' ? <div className="message-avatar">雨</div> : null}
                    <div className="message-wrap">
                      <div className="message-meta"><strong>{message.role === 'assistant' ? data.character.name : '林澈'}</strong><time>{message.time}</time></div>
                      <div className="message-bubble">
                        {message.text.split('\n').map((line, index) => <span key={`${message.id}-${index}`}>{line || '\u00A0'}</span>)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="history-note">清除范围：清除历史不会自动删除已提取的长期记忆，需另行选择。日志与缓存也需要单独勾选。</div>
            </>
          ) : (
            <EmptyState title="没有可查看的会话" description="新建对话后，历史记录会出现在这里。" />
          )}
        </Card>
      </div>

      <ClearScopeDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清除这段会话"
        description="请选择本次真正要移除的内容，未勾选项会保留。"
        confirmLabel="按范围清除"
        onConfirm={clear}
        busy={busy}
      />
    </div>
  )
}
