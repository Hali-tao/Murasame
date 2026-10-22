import { Eye, EyeOff, PlugZap, Plus, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ModelInput, ModelProfile } from '@shared/types'
import { Button, Card, CardHead, Field, Input, Pill, Spinner } from '../components/ui'
import { useAppStore } from '../store'

const capabilityOptions = ['文本', '图像', '语音', '工具调用']
const providerOptions = [
  { value: 'OpenAI Compatible', label: 'OpenAI Compatible / 兼容接口' },
  { value: 'Anthropic', label: 'Anthropic Messages' },
  { value: 'Ollama', label: 'Ollama（OpenAI 兼容）' }
]

function toDraft(model: ModelProfile): ModelInput {
  return { name: model.name, provider: model.provider, endpoint: model.endpoint, key: '', model: model.model, caps: [...model.caps] }
}

function normalizedDraft(draft: ModelInput): ModelInput {
  return {
    ...draft,
    name: draft.name.trim(),
    provider: draft.provider.trim(),
    endpoint: draft.endpoint.trim().replace(/\/+$/, ''),
    key: draft.key.trim(),
    model: draft.model.trim()
  }
}

export function ModelsPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const selectedId = useAppStore((state) => state.selectedModelId)
  const selectModel = useAppStore((state) => state.selectModel)
  const createModel = useAppStore((state) => state.createModel)
  const verifyModel = useAppStore((state) => state.verifyModel)
  const saveModel = useAppStore((state) => state.saveModel)
  const setDefaultModel = useAppStore((state) => state.setDefaultModel)
  const busy = useAppStore((state) => state.busy)
  const notify = useAppStore((state) => state.notify)
  const selected = data.models.find((model) => model.id === selectedId) ?? data.models.find((model) => model.default) ?? data.models[0]
  const [showKey, setShowKey] = useState(false)
  const [draft, setDraft] = useState<ModelInput>(() => selected ? toDraft(selected) : { name: '', provider: 'OpenAI Compatible', endpoint: '', key: '', model: '', caps: [] })
  const defaultModel = data.models.find((model) => model.default)

  useEffect(() => {
    if (!selectedId && data.models[0]) selectModel(data.models[0].id)
  }, [selectedId, data.models, selectModel])

  const dirty = useMemo(() => {
    if (!selected) return false
    const original = toDraft(selected)
    return original.name !== draft.name || original.provider !== draft.provider || original.endpoint !== draft.endpoint || original.key !== draft.key || original.model !== draft.model || original.caps.join('|') !== draft.caps.join('|')
  }, [selected, draft])

  const updateDraft = (patch: Partial<ModelInput>): void => setDraft((current) => ({ ...current, ...patch }))

  const toggleCap = (capability: string): void => {
    setDraft((current) => ({
      ...current,
      caps: current.caps.includes(capability)
        ? current.caps.filter((item) => item !== capability)
        : [...current.caps, capability]
    }))
  }

  const addModel = async (): Promise<void> => {
    const model = await createModel()
    if (model) setDraft(toDraft(model))
    setShowKey(false)
  }

  const save = async (): Promise<void> => {
    if (!selected) return
    if (!draft.name.trim() || !draft.endpoint.trim() || !draft.model.trim()) {
      notify('请填写配置名称、服务地址与模型名称', 'amber')
      return
    }
    const saved = await saveModel(selected.id, normalizedDraft(draft))
    if (saved) {
      setDraft(toDraft(saved))
      setShowKey(false)
    }
  }

  const saveAndDefault = async (): Promise<void> => {
    if (!selected) return
    if (!draft.name.trim() || !draft.endpoint.trim() || !draft.model.trim()) {
      notify('请填写配置名称、服务地址与模型名称', 'amber')
      return
    }
    const saved = await saveModel(selected.id, normalizedDraft(draft))
    if (saved) {
      setDraft(toDraft(saved))
      setShowKey(false)
      await setDefaultModel(saved.id)
    }
  }

  const testConnection = async (): Promise<void> => {
    if (!selected) return
    if (!draft.name.trim() || !draft.endpoint.trim() || !draft.model.trim()) {
      notify('请填写配置名称、服务地址与模型名称', 'amber')
      return
    }
    const tested = await verifyModel(selected.id, normalizedDraft(draft))
    if (tested) {
      setDraft(toDraft(tested))
      setShowKey(false)
    }
  }

  return (
    <div className="page models-page">
      <div className="current-service-banner">
        <div className="current-service-icon"><PlugZap size={18} /></div>
        <div>
          <span>当前服务</span>
          <strong data-testid="current-service-name">{defaultModel?.name ?? '未选择默认模型'}</strong>
          <p>{defaultModel ? `${defaultModel.model || '未填写模型'} · ${defaultModel.hasKey ? '密钥已保存' : '未配置密钥'} · ${defaultModel.latency}` : '请选择一个有效配置'}</p>
        </div>
        <Pill tone={defaultModel?.status === '在线' ? 'green' : 'amber'}>{defaultModel?.status ?? '未验证'}</Pill>
        <Button size="sm" disabled={!defaultModel || Boolean(busy['model:verify'])} onClick={() => defaultModel && void verifyModel(defaultModel.id)}>
          验证当前服务
        </Button>
      </div>

      <div className="model-layout">
        <Card className="model-list-card">
          <CardHead
            title="服务配置"
            subtitle="切换失败时保留原配置"
            aside={<Button size="sm" onClick={() => void addModel()} disabled={Boolean(busy['model:create'])} icon={<Plus size={15} />} aria-label="添加模型配置" data-testid="add-model" />}
          />
          <div className="model-list">
            {data.models.map((model) => (
              <button
                type="button"
                key={model.id}
                data-testid="model-item"
                className={`model-list-item${model.id === selected?.id ? ' active' : ''}`}
                onClick={() => {
                  selectModel(model.id)
                  setDraft(toDraft(model))
                }}
              >
                <div className="model-list-top"><strong>{model.name}</strong><Pill tone={model.tone}>{model.status}</Pill></div>
                <p>{model.provider} · {model.model || '未填写模型'}</p>
                <div className="model-list-foot"><span>{model.hasKey ? `密钥已保存 · ${model.latency}` : '未配置密钥'}</span>{model.default ? <Pill tone="coral">当前</Pill> : null}</div>
              </button>
            ))}
          </div>
          <p className="fineprint"><ShieldCheck size={13} />凭据加密保存；错误提示与日志不会展示完整密钥。</p>
        </Card>

        <Card className="model-editor-card">
          {selected ? (
            <>
              <div className="model-editor-head">
                <div><h2>{selected.name}</h2><p>{selected.provider} · 配置更改在验证和保存后生效</p></div>
                <div className="model-editor-pills"><Pill tone={selected.tone}>{selected.status}</Pill>{dirty ? <Pill tone="amber">未保存</Pill> : null}</div>
              </div>
              <div className="form-grid two">
                <Field label="配置名称"><Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} maxLength={80} data-testid="model-config-name" /></Field>
                <Field label="接口协议">
                  <select className="select" value={draft.provider} onChange={(event) => updateDraft({ provider: event.target.value })} data-testid="model-provider">
                    {providerOptions.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
                  </select>
                </Field>
                <Field label="模型名称"><Input value={draft.model} onChange={(event) => updateDraft({ model: event.target.value })} placeholder="gpt-5.1" maxLength={200} data-testid="model-name" /></Field>
                <Field label="服务地址" className="span-two" hint="OpenAI 兼容服务通常填写到 /v1，例如 https://api.openai.com/v1"><Input value={draft.endpoint} onChange={(event) => updateDraft({ endpoint: event.target.value })} maxLength={500} data-testid="model-endpoint" /></Field>
                <Field label="API Key" className="span-two" hint={selected.hasKey ? '已使用 Windows 安全存储保存；留空表示保持不变。' : '密钥只发送到主进程并加密保存，不会写入日志。'}>
                  <div className="secret-field">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={draft.key}
                      onChange={(event) => updateDraft({ key: event.target.value })}
                      maxLength={500}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={selected.hasKey ? '已保存，留空保持不变' : '填写服务商提供的 API Key'}
                      data-testid="model-key"
                    />
                    <button type="button" className="secret-toggle" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
              </div>
              <div className="model-credential-line">
                <Pill tone={selected.hasKey ? 'green' : 'amber'}>{selected.hasKey ? '密钥已安全保存' : '尚未保存密钥'}</Pill>
                <span>关闭窗口或重启应用后配置仍会保留。</span>
              </div>
              <div className="capability-editor">
                <span className="field-label">能力声明</span>
                <div className="capability-chips">
                  {capabilityOptions.map((capability) => (
                    <button
                      type="button"
                      key={capability}
                      className={draft.caps.includes(capability) ? 'cap-chip active' : 'cap-chip'}
                      onClick={() => toggleCap(capability)}
                    >
                      {capability}
                    </button>
                  ))}
                </div>
                <p>如果服务不支持图像或语音，对应入口会显示为不可用，不会静默降级。</p>
              </div>
              <div className="verify-strip">
                <div><strong>上次验证</strong><span>{selected.status === '在线' ? `连接正常 · 响应 ${selected.latency}` : '尚未验证此配置'}</span></div>
                <Button size="sm" onClick={() => void testConnection()} disabled={Boolean(busy['model:verify'])} icon={busy['model:verify'] ? <Spinner size={13} /> : <PlugZap size={14} />} data-testid="verify-model">
                  {busy['model:verify'] ? '正在请求…' : '保存并测试连接'}
                </Button>
              </div>
              <div className="inline-note blue-note"><strong>切换策略</strong> 新任务使用新配置，运行中任务保持原配置。切换失败时，已有有效配置不会失效。</div>
              <div className="model-actions">
                <Button onClick={() => void save()} disabled={Boolean(busy['model:save'])} data-testid="save-model">保存修改</Button>
                <Button variant="primary" onClick={() => void saveAndDefault()} disabled={Boolean(busy['model:save']) || Boolean(busy['model:default'])} data-testid="set-default-model">保存并设为当前服务</Button>
              </div>
            </>
          ) : (
            <div className="model-empty">还没有服务配置，点击左上角「+」创建一个。</div>
          )}
        </Card>
      </div>
    </div>
  )
}
