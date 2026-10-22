import { Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { MemoryEntry } from '@shared/types'
import { MemoryEditDialog } from '../components/dialogs'
import { Button, Card, ConfirmDialog, EmptyState, Pill, StatTile, ToggleSwitch } from '../components/ui'
import { useAppStore } from '../store'

export function MemoryPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const updateSettings = useAppStore((state) => state.updateSettings)
  const deleteMemory = useAppStore((state) => state.deleteMemory)
  const clearMemories = useAppStore((state) => state.clearMemories)
  const notify = useAppStore((state) => state.notify)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部类别')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<MemoryEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MemoryEntry | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [busyDelete, setBusyDelete] = useState(false)
  const [busyClear, setBusyClear] = useState(false)

  const categories = ['全部类别', ...Array.from(new Set(data.memories.map((memory) => memory.category)))]
  const filtered = data.memories.filter((memory) => {
    const matchSearch = `${memory.category}${memory.text}${memory.source}`.toLowerCase().includes(search.trim().toLowerCase())
    const matchCategory = category === '全部类别' || memory.category === category
    return matchSearch && matchCategory
  })

  const toggleMemory = async (checked: boolean): Promise<void> => {
    const saved = await updateSettings({ memoryEnabled: checked })
    if (saved) notify(checked ? '长期记忆已启用' : '长期记忆已停用，现有条目仍可查看', checked ? 'green' : 'amber')
  }

  const openAdd = (): void => {
    setEditing(null)
    setEditOpen(true)
  }

  const openEdit = (entry: MemoryEntry): void => {
    setEditing(entry)
    setEditOpen(true)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setBusyDelete(true)
    const deleted = await deleteMemory(deleteTarget.id)
    setBusyDelete(false)
    if (deleted) setDeleteTarget(null)
  }

  const confirmClear = async (): Promise<void> => {
    setBusyClear(true)
    const cleared = await clearMemories()
    setBusyClear(false)
    if (cleared) setClearOpen(false)
  }

  return (
    <div className="page memory-page">
      <div className={`memory-banner${data.settings.memoryEnabled ? '' : ' disabled'}`}>
        <div className="banner-copy">
          <div className="banner-titleline">
            <Pill tone="violet">{data.settings.memoryEnabled ? '自动提取已启用' : '记忆已停用'}</Pill>
            <strong>长期记忆不是对话历史</strong>
          </div>
          <p>从交流与任务中提取稳定信息，跨会话使用。关闭后停止提取与召回，已有条目仍可查看。</p>
        </div>
        <div className="banner-toggle">
          <span>启用记忆</span>
          <ToggleSwitch checked={data.settings.memoryEnabled} onCheckedChange={(checked) => void toggleMemory(checked)} label="启用长期记忆" />
        </div>
      </div>

      <div className="stat-grid four">
        <StatTile label="记忆条目" value={data.memories.length} caption="可逐条更正或删除" tone="violet" />
        <StatTile label="自动提取" value={data.settings.memoryAutoExtract ? '开启' : '关闭'} caption="失败时不展示未保存内容" tone="green" />
        <StatTile label="最近更新" value="今天" caption="3 条来自对话与任务" tone="coral" />
        <StatTile label="隐私边界" value="本地" caption="加密存储，不默认外发" tone="blue" />
      </div>

      <div className="memory-toolbar">
        <div className="search-box wide">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索记忆内容…" aria-label="搜索记忆" />
        </div>
        <select className="select" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="筛选类别">
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <div className="toolbar-spacer" />
        <Button variant="danger" size="sm" onClick={() => setClearOpen(true)} disabled={!data.memories.length} icon={<Trash2 size={14} />}>
          清空…
        </Button>
        <Button variant="primary" size="sm" onClick={openAdd} icon={<Plus size={15} />} data-testid="add-memory">
          添加记忆
        </Button>
      </div>

      <div className="memory-grid">
        {filtered.map((memory) => (
          <Card className="memory-card" key={memory.id} data-testid="memory-card">
            <div className="memory-card-head">
              <Pill tone="violet">{memory.category}</Pill>
              <span>{memory.updated}</span>
            </div>
            <p>{memory.text}</p>
            <div className="memory-card-foot">
              <span>{memory.source}</span>
              <div>
                <button type="button" onClick={() => openEdit(memory)}>编辑</button>
                <button type="button" className="danger-link" onClick={() => setDeleteTarget(memory)}>删除</button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {!filtered.length ? (
        <EmptyState
          title={data.memories.length ? '没有匹配的记忆' : '还没有长期记忆'}
          description={data.memories.length ? '尝试清空搜索或切换类别。' : '添加一条稳定偏好，或从交流中开启自动提取。'}
          action={<Button variant="primary" onClick={openAdd}>添加第一条记忆</Button>}
        />
      ) : null}

      <MemoryEditDialog key={editing?.id ?? 'new'} open={editOpen} onOpenChange={setEditOpen} entry={editing} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="删除这条长期记忆？"
        description="删除后，后续对话不会再召回这条信息，但既有对话历史不受影响。"
        confirmLabel="删除记忆"
        tone="red"
        onConfirm={confirmDelete}
        busy={busyDelete}
      >
        {deleteTarget ? <div className="delete-preview"><Pill tone="violet">{deleteTarget.category}</Pill><p>{deleteTarget.text}</p></div> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清空全部长期记忆？"
        description="此操作不可撤销。对话历史、任务记录和工具配置不会被删除。"
        confirmLabel="清空全部记忆"
        tone="red"
        onConfirm={confirmClear}
        busy={busyClear}
      >
        <p className="muted">当前共有 {data.memories.length} 条记忆条目。清空后，村雨将不再使用这些跨会话信息。</p>
      </ConfirmDialog>
    </div>
  )
}
