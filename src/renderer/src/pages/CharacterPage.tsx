import { Check, Plus, RotateCcw, Save, X } from 'lucide-react'
import { useState } from 'react'
import { getPetPreset, PET_PRESETS } from '@shared/pet-presets'
import type { CharacterProfile } from '@shared/types'
import { Button, Card, CardHead, Field, Input, Pill, Textarea, ToggleRow } from '../components/ui'
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
  const [switching, setSwitching] = useState(false)
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

  const selectPreset = async (presetId: (typeof PET_PRESETS)[number]['id']): Promise<void> => {
    if (presetId === data.settings.petPreset || switching) return
    setSwitching(true)
    const preset = getPetPreset(presetId)
    const saved = await updateSettings({ petPreset: presetId })
    setSwitching(false)
    if (saved) notify(`桌宠形象已切换为「${preset.name}」`)
  }

  return (
    <div className="page character-page">
      <div className="character-layout">
        <div className="character-left">
          <Card>
            <CardHead title="预置形象" subtitle="选择桌宠窗口中显示的角色" />
            <div className="preset-list">
              {PET_PRESETS.map((preset) => {
                const active = preset.id === data.settings.petPreset
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
                      <span className="preset-meta">{preset.format} · {preset.motionCount}</span>
                    </span>
                    <span className="preset-state">
                      {active ? <><Check size={13} />使用中</> : '选择'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="fineprint">切换后桌宠会自动重新加载，无需重启应用。</p>
          </Card>

          <Card>
            <CardHead title="资源包格式" subtitle="当前版本只读取随应用提供的预置资源" />
            <div className="resource-list">
              <div><span>当前模型</span><Pill tone="green">{activePreset.name}</Pill></div>
              <div><span>模型描述</span><Pill tone="violet">{activePreset.format}</Pill></div>
              <div><span>必要文件</span><span>model3.json + moc3</span></div>
              <div><span>可选文件</span><span>纹理 / physics / motion3 / exp3</span></div>
              <div><span>表现资源</span><span>{activePreset.motionCount} · {activePreset.expressionCount}</span></div>
              <div><span>素材来源</span><span>{activePreset.source}</span></div>
              <div><span>许可说明</span><span>{activePreset.license}</span></div>
            </div>
            <p className="fineprint">当前版本不提供模型导入、动作或表情编辑，也不承诺兼容任意第三方资源包。新增形象需在构建时按 Cubism 资源结构内置。</p>
          </Card>
        </div>

        <Card className="character-editor">
          <CardHead
            title="角色设定"
            subtitle="后续交流使用新的有效配置；取消不会保存未确认修改"
            aside={dirty ? <Pill tone="amber">未保存</Pill> : <Pill tone="green">已保存</Pill>}
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
    </div>
  )
}
