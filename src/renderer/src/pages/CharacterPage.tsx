import { Check, Plus, RotateCcw, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getPetPreset, PET_PRESETS } from '@shared/pet-presets'
import type { AppSettings, CharacterProfile, RelationshipView } from '@shared/types'
import { Button, Card, CardHead, ConfirmDialog, Field, Input, Modal, Pill, Textarea, ToggleRow } from '../components/ui'
import { StatusPill } from '../components/StatusPill'
import { useAppStore } from '../store'

const keywordSuggestions = ['温柔克制', '冷静专业', '简洁', '少量俏皮', '活跃']

export function CharacterPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const saveCharacter = useAppStore((state) => state.saveCharacter)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const notify = useAppStore((state) => state.notify)
  const busy = useAppStore((state) => Boolean(state.busy['character:save']))
  const [draft, setDraft] = useState<CharacterProfile>(data.character)
  const [customKeyword, setCustomKeyword] = useState('')
  const [importPath, setImportPath] = useState('')
  const [importNote, setImportNote] = useState('')
  const [importedUrl, setImportedUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [relationship, setRelationship] = useState<RelationshipView | null>(null)
  const [relationshipError, setRelationshipError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [relationshipBusy, setRelationshipBusy] = useState(false)
  const [appearance, setAppearance] = useState<Pick<Partial<AppSettings>, 'petPreset' | 'importedModelUrl' | 'importedCharacterName'> | null>(null)
  const [relationshipMode, setRelationshipMode] = useState<'continue' | 'new'>('continue')
  const relationRevision = useRef(0)
  const dateLabel = (value: string): string => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN') }

  useEffect(() => {
    let stopped = false
    const load = async (): Promise<void> => {
      const revision = ++relationRevision.current
      try {
        const current = await window.murasame.relationship.get()
        if (!stopped && relationRevision.current === revision) { setRelationship(current); setRelationshipError('') }
      } catch { if (!stopped) setRelationshipError('关系状态暂时无法读取，请稍后重试。') }
    }
    void load()
    const stopRelation = window.murasame.relationship.onChanged?.((current) => { relationRevision.current++; setRelationship(current) })
    const stopConversation = window.murasame.events?.onConversationUpdated?.(() => { void load() })
    return () => { stopped = true; stopRelation?.(); stopConversation?.() }
  }, [])
  const activePreset = getPetPreset(data.settings.petPreset)

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.character)

  const update = (patch: Partial<CharacterProfile>): void => setDraft((current) => ({ ...current, ...patch }))

  const toggleKeyword = (keyword: string): void => {
    setDraft((current) => ({
      ...current,
      keywords: current.keywords.includes(keyword)
        ? current.keywords.filter((item) => item !== keyword)
        : [...current.keywords, keyword]
    }))
  }

  const addKeyword = (): void => {
    const value = customKeyword.trim()
    if (!value || draft.keywords.includes(value)) return
    update({ keywords: [...draft.keywords, value].slice(0, 12) })
    setCustomKeyword('')
  }

  const save = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.style.trim()) {
      notify('角色名称和交流风格不能为空', 'amber')
      return
    }
    await saveCharacter({ ...draft, name: draft.name.trim(), style: draft.style.trim() })
  }

  const reset = (): void => setDraft(data.character)

  const changeImportPath = (path: string): void => {
    setImportPath(path)
    setImportedUrl('')
    setImportNote('')
  }

  const importAsset = async (): Promise<void> => {
    const path = importPath.trim()
    if (!path || importing) return
    setImporting(true)
    setImportedUrl('')
    try {
      const result = await window.murasame.character.importAsset(path)
      if (!result.ok) {
        setImportedUrl('')
        setImportNote(result.error)
        notify(result.error, 'red')
        return
      }
      setImportedUrl(result.data.modelUrl)
      setImportNote('资源已校验并复制。当前形象保持不变，确认使用后才会替换。')
    } catch (error) {
      setImportNote(error instanceof Error ? error.message : '导入失败，请重试')
    } finally { setImporting(false) }
  }

  const requestAppearance = (patch: Pick<Partial<AppSettings>, 'petPreset' | 'importedModelUrl' | 'importedCharacterName'>): void => {
    if (switching) return
    setRelationshipMode('continue')
    setAppearance(patch)
  }

  const applyImported = (): void => {
    if (importedUrl) requestAppearance({ importedModelUrl: importedUrl, importedCharacterName: data.character.name || '导入的形象' })
  }

  const selectPreset = (presetId: (typeof PET_PRESETS)[number]['id']): void => {
    if (presetId === data.settings.petPreset && !data.settings.importedModelUrl) return
    requestAppearance({ petPreset: presetId, importedModelUrl: '', importedCharacterName: '' })
  }

  const confirmAppearance = async (): Promise<void> => {
    if (!appearance || switching) return
    setSwitching(true)
    relationRevision.current++
    try {
      const result = await window.murasame.relationship.changeAppearance({ patch: appearance, mode: relationshipMode })
      useAppStore.setState((state) => ({ data: state.data ? { ...state.data, settings: result.settings } : null }))
      setRelationship(result.relationship)
      setRelationshipError('')
      setAppearance(null)
      notify(relationshipMode === 'new' ? '已更换形象并开始新的关系线，已有数据保留' : '已更换形象，现有记忆与关系继续保留')
    } catch (error) { notify(error instanceof Error ? error.message : '更换形象失败，请重试', 'red') }
    finally { setSwitching(false) }
  }

  const confirmReset = async (): Promise<void> => {
    if (relationshipBusy) return
    setRelationshipBusy(true)
    relationRevision.current++
    try {
      setRelationship(await window.murasame.relationship.reset())
      setRelationshipError('')
      setResetOpen(false)
      notify('当前关系已回到初识，演变记录仍可查看')
    } catch (error) { notify(error instanceof Error ? error.message : '重置关系失败，请重试', 'red') }
    finally { setRelationshipBusy(false) }
  }

  return (
    <div className="page character-page">
      <div className="character-overview"><div><strong>当前外观：{data.settings.importedModelUrl ? (data.settings.importedCharacterName || '自定义形象') : activePreset.name}</strong><p>外观决定桌宠的样子，交流设定决定称呼和语气。聊天历史与长期记忆会保留。</p></div><Pill tone={dirty ? 'amber' : 'green'}>{dirty ? '交流设定尚未保存' : '交流设定已保存'}</Pill></div>
      <div className="character-layout">
        <div className="character-left">
          <Card>
            <CardHead title="桌宠外观" subtitle="选择形象后确认切换，不改变交流设定" />
            <div className="preset-list">
              {PET_PRESETS.map((preset) => {
                const active = preset.id === data.settings.petPreset && !data.settings.importedModelUrl
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-option${active ? ' active' : ''}`}
                    onClick={() => void selectPreset(preset.id)}
                    aria-pressed={active}
                    data-testid={`pet-preset-${preset.id}`}
                  >
                    <span className={`preset-mark preset-mark-${preset.tone}`}>{preset.mark}</span>
                    <span className="preset-copy">
                      <strong>{preset.name}</strong>
                      <span>{preset.summary}</span>
                    </span>
                    <span className="preset-state">
                      {active ? <><Check size={13} />使用中</> : '选择'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="fineprint">奶娃、奶龙仅用于课程演示；鲸鱼娘为 CC BY-NC-SA，非商业使用并需署名。</p>
          </Card>


        </div>

        <Card className="character-editor">
          <CardHead
            title="交流设定"
            subtitle="名称、语气和互动偏好在点击「保存设定」后生效"
            aside={<StatusPill status={dirty ? 'unsaved' : 'saved'} />}
          />
          <Field label="名称"><Input value={draft.name} maxLength={40} onChange={(event) => update({ name: event.target.value })} /></Field>
          <div className="field-block">
            <span className="field-label">性格关键词</span>
            <div className="keyword-list">
              {keywordSuggestions.map((keyword) => (
                <button type="button" key={keyword} className={draft.keywords.includes(keyword) ? 'keyword-chip active' : 'keyword-chip'} onClick={() => toggleKeyword(keyword)}>{keyword}</button>
              ))}
              {draft.keywords.filter((keyword) => !keywordSuggestions.includes(keyword)).map((keyword) => (
                <span key={keyword} className="keyword-chip custom">{keyword}<button type="button" aria-label={`移除 ${keyword}`} onClick={() => toggleKeyword(keyword)}><X size={11} /></button></span>
              ))}
            </div>
            <div className="inline-add">
              <Input value={customKeyword} maxLength={30} onChange={(event) => setCustomKeyword(event.target.value)} placeholder="添加自定义关键词" onKeyDown={(event) => { if (event.key === 'Enter') addKeyword() }} />
              <Button size="sm" onClick={addKeyword} disabled={!customKeyword.trim()} icon={<Plus size={14} />}>添加</Button>
            </div>
          </div>
          <Field label="交流风格"><Input value={draft.style} maxLength={80} onChange={(event) => update({ style: event.target.value })} /></Field>
          <Field label="对话示例" hint="示例用于约束语气，不会覆盖安全边界。">
            <Textarea className="character-example" value={draft.example} maxLength={2000} rows={6} onChange={(event) => update({ example: event.target.value })} />
          </Field>
          <div className="character-toggles">
            <ToggleRow title="主动互动" description="空闲且未打扰时允许角色主动开口。" checked={draft.proactive} onCheckedChange={(checked) => update({ proactive: checked })} />
            <ToggleRow title="在交流中参考长期记忆" description="关闭后不再以已有偏好组织个性化回应。" checked={draft.memory} onCheckedChange={(checked) => update({ memory: checked })} />
          </div>
          <div className="editor-actions">
            <Button onClick={reset} disabled={!dirty || busy} icon={<RotateCcw size={14} />}>取消修改</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || busy} icon={<Save size={14} />} data-testid="save-character">保存设定</Button>
          </div>
        </Card>
      </div>
      <div className="character-secondary">
        <Card>
            <CardHead title="熟悉程度" subtitle="随互动逐渐变化；重置不会删除聊天历史或长期记忆" aside={<Button size="sm" onClick={() => setResetOpen(true)} disabled={!relationship || relationshipBusy}>重置关系</Button>} />
            {relationship ? (
              <div className="relationship-history">
                <strong>当前阶段：{relationship.stage}</strong>
                <p>从 {dateLabel(relationship.since)} 开始，称呼与语气以当前阶段为参考。</p>
                <ul>{relationship.history.map((item, index) => <li key={`${item.since}-${index}`}><span>{item.stage}</span> · <time>{dateLabel(item.since)}</time></li>)}</ul>
                {relationship.archivedLines?.length ? <details><summary>之前的关系线</summary>{relationship.archivedLines.map(line => <ul key={line.lineId}>{line.history.map((item, index) => <li key={`${item.since}-${index}`}>{item.stage} · {dateLabel(item.since)}</li>)}</ul>)}</details> : null}
              </div>
            ) : <p className="muted">{relationshipError || '正在读取关系状态…'}</p>}
            <p className="fineprint">短期情绪会随空闲逐渐回归平静；重启从平静状态开始，长期关系与记忆不受影响。</p>
          </Card>
      <Card className="character-theater">
        <CardHead title="桌面表现" subtitle="此处开关立即生效，不需要点击「保存设定」" />
        <ToggleRow
          title="桌面小剧场"
          description="任务进入终态时在桌宠脚边演一句真实结果；关闭后不再自动演出，可随时恢复。"
          checked={data.settings.theaterEnabled}
          onCheckedChange={(checked) => void updateSettings({ theaterEnabled: checked })}
        />
      </Card>
      </div>
        <Card>
            <CardHead title="导入自定义形象" subtitle="选择资源 → 校验并导入 → 使用该形象；确认后才替换当前外观" />
            <details className="character-resource-details"><summary>支持的格式与当前形象信息</summary>
            <div className="resource-list">
              <div><span>当前模型</span><Pill tone="green">{data.settings.importedModelUrl ? (data.settings.importedCharacterName || '自定义形象') : activePreset.name}</Pill></div>
              <div><span>模型描述</span><Pill tone="violet">{data.settings.importedModelUrl ? '导入的 Live2D 模型' : activePreset.format}</Pill></div>
              <div><span>必要文件</span><span>model3.json、moc3 和贴图</span></div>
              <div><span>可选文件</span><span>物理 / 动作 / 表情</span></div>
              {!data.settings.importedModelUrl ? <><div><span>表现资源</span><span>{activePreset.motionCount} · {activePreset.expressionCount}</span></div>
              <div><span>素材来源</span><span>{activePreset.source}</span></div>
              <div><span>许可说明</span><span>{activePreset.license}</span></div></> : null}
            </div>
            <p className="fineprint">Cubism 2.1 的 .moc 和缺少贴图的包会被拒绝，原来的角色保持不变。未确认使用前，不会把新资源显示为当前形象。</p></details>
            <Field label="形象文件">
              <div className="character-import-picker">
                <Input disabled={importing} value={importPath} placeholder="用下面的按钮选择目录或 zip" onChange={(event) => changeImportPath(event.target.value)} />
                <Button disabled={importing} onClick={() => void window.murasame.app.pickOpen({ title: '选择形象目录或 zip', filters: [{ name: 'Live2D', extensions: ['zip'] }] }).then((path) => { if (path) changeImportPath(path) })}>选择文件</Button>
                <Button disabled={importing} onClick={() => void window.murasame.app.pickOpen({ title: '选择形象目录', directory: true }).then((path) => { if (path) changeImportPath(path) })}>选择目录</Button>
              </div>
            </Field>
            <div className="editor-actions">
              <Button onClick={() => void importAsset()} disabled={importing || !importPath.trim()}>{importing ? '正在校验…' : '校验并导入'}</Button>
              <Button variant="primary" onClick={() => void applyImported()} disabled={importing || !importedUrl}>使用该形象</Button>
            </div>
            {importNote ? <p className="fineprint">{importNote}</p> : null}
          </Card>
      <ConfirmDialog open={resetOpen} onOpenChange={setResetOpen} title="重置当前关系？" description="回到初识。原有对话、记忆和演变记录会保留。" confirmLabel="确认重置" onConfirm={confirmReset} busy={relationshipBusy} />
      <Modal open={Boolean(appearance)} onOpenChange={(open) => { if (!open && !switching) setAppearance(null) }} title="更换形象" description="选择更换外观后是否保留当前的熟悉程度。无论选择哪一项，聊天历史和长期记忆都会保留。" footer={<><Button disabled={switching} onClick={() => setAppearance(null)}>取消</Button><Button variant="primary" disabled={switching} onClick={() => void confirmAppearance()}>确认更换</Button></>}>
        <fieldset className="relationship-choice">
          <legend>熟悉程度</legend>
          <label><input type="radio" name="relationship-mode" checked={relationshipMode === 'continue'} onChange={() => setRelationshipMode('continue')} /><span>只更换外观，保留熟悉程度</span></label>
          <label><input type="radio" name="relationship-mode" checked={relationshipMode === 'new'} onChange={() => setRelationshipMode('new')} /><span>更换外观，熟悉程度从初识开始</span></label>
          <p className="muted">从初识开始会重新累计互动，之前的关系演变记录仍可查看，不会清空聊天历史或长期记忆。</p>
        </fieldset>
      </Modal>
    </div>
  )
}
