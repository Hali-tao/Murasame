import { AlertCircle, CheckCircle2, Eye, EyeOff, PlugZap, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ModelInput, ModelProfile } from '@shared/types'
import { matchPreset, MODEL_PRESETS, presetById } from '@shared/model-presets'
import { Button, Card, CardHead, EmptyState, Field, Input, Pill, Spinner } from '../components/ui'
import { StatusPill } from '../components/StatusPill'
import { useAppStore } from '../store'

const providerOptions = [
  { value: 'OpenAI Compatible', label: 'OpenAI 兼容接口' },
  { value: 'Anthropic', label: 'Anthropic Messages' },
  { value: 'Ollama', label: 'Ollama（OpenAI 兼容）' }
]

const capabilityLabel: Record<string, string> = {
  'text.chat': '对话',
  'text.stream': '流式输出',
  'vision.image-input': '看图',
  'tools.function-calling': '工具调用',
  'output.json-schema': '结构化输出'
}

const blankDraft = (): ModelInput => ({
  name: '',
  provider: 'OpenAI Compatible',
  endpoint: '',
  key: '',
  model: '',
  caps: []
})

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

function hostOf(endpoint: string): string {
  if (!endpoint) return '自己填地址'
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

function friendlyFailure(detail: string, modelName: string): string {
  if (/401|403|API Key/.test(detail)) {
    return `密钥没有通过。确认贴的是这家服务商的 Key，前后没有空格。${detail}`
  }
  if (modelName === 'deepseek' || (/HTTP 400/.test(detail) && /deepseek/i.test(`${detail} ${modelName}`) && !/deepseek-flash|deepseek-v4-pro|deepseek-chat/.test(modelName))) {
    return `模型名称不对。DeepSeek 不能填 deepseek，请改成 deepseek-flash 或 deepseek-v4-pro 后再验证。${detail}`
  }
  if (/模型名称不存在|model.+not found|HTTP 404/i.test(detail)) {
    return `模型名称在这家服务里不存在。请改成上面列出的名称，或按服务商文档填写。${detail}`
  }
  return detail
}

export function ModelsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const selectedId = useAppStore((state) => state.selectedModelId)
  const selectModel = useAppStore((state) => state.selectModel)
  const createModel = useAppStore((state) => state.createModel)
  const verifyModel = useAppStore((state) => state.verifyModel)
  const deleteModel = useAppStore((state) => state.deleteModel)
  const setDefaultModel = useAppStore((state) => state.setDefaultModel)
  const busy = useAppStore((state) => state.busy)
  const notify = useAppStore((state) => state.notify)
  const selected = data.models.find((model) => model.id === selectedId) ?? data.models.find((model) => model.default) ?? data.models[0]
  const [showKey, setShowKey] = useState(false)
  const [localFailure, setLocalFailure] = useState('')
  const [failureContext, setFailureContext] = useState<'selected' | 'current' | 'operation'>('selected')
  // An untouched form follows late results, including after leaving and returning.
  // Only user edits need a local override of the saved profile.
  const [draftOverride, setDraft] = useState<ModelInput | null>(null)
  const draft = draftOverride ?? (selected ? toDraft(selected) : blankDraft())
  const [formAction, setFormAction] = useState('')
  const actionInFlight = useRef(false)
  const defaultModel = data.models.find((model) => model.default)
  const using = Boolean(defaultModel && defaultModel.status === '在线')
  const activePreset = matchPreset(draft.endpoint, draft.provider)
  const preset = presetById(activePreset)
  const verifying = Boolean(busy['model:verify'])
  const modelBusy = Object.entries(busy).some(([key, value]) => key.startsWith('model:') && value)
  const formBusy = Boolean(formAction) || modelBusy

  useEffect(() => {
    if (!selectedId && data.models[0]) selectModel(data.models[0].id)
  }, [selectedId, data.models, selectModel])

  const dirty = useMemo(() => {
    if (!selected) return Boolean(draft.name || draft.endpoint || draft.model || draft.key)
    const original = toDraft(selected)
    return original.name !== draft.name || original.provider !== draft.provider || original.endpoint !== draft.endpoint || original.key !== draft.key || original.model !== draft.model
  }, [selected, draft])

  const updateDraft = (patch: Partial<ModelInput>): void => {
    setLocalFailure('')
    setDraft((current) => ({ ...(current ?? draft), ...patch }))
  }

  const applyPreset = (presetId: string): void => {
    const next = presetById(presetId)
    if (!next) return
    setLocalFailure('')
    setDraft((override) => {
      const current = override ?? draft
      const namedLikePreset = MODEL_PRESETS.some((item) => item.label === current.name.trim())
      const genericName = !current.name.trim() || current.name.trim() === '新的模型配置' || namedLikePreset
      const belongsToNext = next.models.some((model) => model.id === current.model.trim())
      const belongedElsewhere = MODEL_PRESETS.some((item) =>
        item.id !== next.id && (item.suggestedModel === current.model.trim() || item.models.some((model) => model.id === current.model.trim()))
      )
      const alreadyCustom = matchPreset(current.endpoint, current.provider) === 'custom'
      return {
        ...current,
        name: genericName ? (next.id === 'custom' ? '自定义服务' : next.label) : current.name,
        provider: next.provider,
        endpoint: next.id === 'custom' ? (alreadyCustom ? current.endpoint : '') : next.endpoint,
        model: belongsToNext ? current.model : (next.suggestedModel || (belongedElsewhere ? '' : current.model)),
        caps: current.caps
      }
    })
  }

  const chooseModel = (model: ModelProfile): void => {
    selectModel(model.id)
    setDraft(null)
    setLocalFailure('')
    setShowKey(false)
  }

  const removeModel = async (): Promise<void> => {
    if (!selected) return
    const removed = await deleteModel(selected.id)
    if (!removed) return
    setDraft(null)
    setLocalFailure('')
    setShowKey(false)
  }

  const addModel = async (): Promise<void> => {
    const model = await createModel()
    if (!model) return
    setDraft(null)
    setLocalFailure('')
    setShowKey(false)
  }

  const explain = (model: ModelProfile): string => {
    const chat = model.capabilities.find((item) => item.id === 'text.chat')
    return friendlyFailure(chat?.detail || '没有连上，请检查密钥、服务地址和模型名称', model.model.trim())
  }

  const verifyAndUse = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.endpoint.trim() || !draft.model.trim()) {
      const text = '还不能验证：先点一个服务商。服务地址和模型名称都会自动填上，确认无误后再验证。'
      setLocalFailure(text)
      notify(text, 'amber')
      return
    }
    if (preset?.needsKey !== false && !draft.key.trim() && !selected?.hasKey) {
      const text = '还没有 API Key。把密钥贴进下面的输入框，再点验证并开始使用。'
      setLocalFailure(text)
      notify(text, 'amber')
      return
    }
    setLocalFailure('')
    let id = selected?.id
    if (!id) {
      const created = await createModel()
      if (!created) return
      id = created.id
    }
    setFailureContext('selected')
    const tested = await verifyModel(id, normalizedDraft(draft))
    if (!tested) {
      const toast = useAppStore.getState().toasts.filter((item) => item.tone === 'red').at(-1)
      setLocalFailure(toast?.message || '验证失败，请检查密钥、服务地址和模型名称')
      return
    }
    setDraft(null)
    setShowKey(false)
    if (tested.status !== '在线') {
      setLocalFailure(explain(tested))
      return
    }
    setFailureContext('operation')
    const enabled = await setDefaultModel(tested.id)
    if (!enabled) {
      setLocalFailure('连接是通的，但没有切换成当前服务。再点一次「设为当前使用」。')
      return
    }
    setLocalFailure('')
  }

  const activateSaved = async (): Promise<void> => {
    if (!selected) return
    const enabled = await setDefaultModel(selected.id)
    if (enabled) setLocalFailure('')
  }

  const recheckCurrent = async (): Promise<void> => {
    if (!defaultModel) return
    setLocalFailure('')
    setFailureContext('current')
    const tested = await verifyModel(defaultModel.id)
    if (!tested) {
      const toast = useAppStore.getState().toasts.filter((item) => item.tone === 'red').at(-1)
      setLocalFailure(toast?.message || '验证失败')
      return
    }
    if (tested.id === selected?.id && !dirty) setDraft(null)
    if (tested.status !== '在线') setLocalFailure(explain(tested))
  }

  const runFormAction = async (label: string, action: () => Promise<void>): Promise<void> => {
    if (actionInFlight.current || modelBusy) return
    actionInFlight.current = true
    setFormAction(label)
    setFailureContext('operation')
    try {
      await action()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const message = `操作没有完成：${detail}`
      setLocalFailure(message)
      notify(message, 'red')
    } finally {
      actionInFlight.current = false
      setFormAction('')
    }
  }

  // Persisted capabilities describe the last probe, not the cause of a later request failure.
  const staleFailure = !dirty && selected?.status === '离线'
    ? '最近请求未成功。请查看对话或任务中的错误提示，检查网络与服务后重试，也可以点「再测一次」。'
    : ''
  const shownFailure = localFailure || staleFailure
  const verificationFailure = Boolean(localFailure) && failureContext !== 'operation'
  const failedVerificationModelId = shownFailure && verificationFailure
    ? localFailure && failureContext === 'current' ? defaultModel?.id : selected?.id
    : undefined
  const failedCurrentVerification = Boolean(defaultModel && failedVerificationModelId === defaultModel.id)
  const currentOffline = defaultModel?.status === '离线'
  const failureTitle = !localFailure && staleFailure
    ? '服务离线，配置已保留'
    : !verificationFailure
    ? '本次操作未完成'
    : failedCurrentVerification
      ? '本次验证未通过，当前配置已保留'
      : defaultModel
        ? '这条配置未启用，当前服务配置未变'
        : '验证未通过，这条配置还未启用'
  const failureRetention = !verificationFailure
    ? ''
    : failedCurrentVerification
      ? `「${defaultModel?.name}」仍是当前服务配置。本次未能确认连接，请检查后重试。`
      : defaultModel
        ? `本次没有切换当前服务，仍保留「${defaultModel.name}」的配置。`
        : '验证通过后才能设为当前使用。'
  const readyHere = Boolean(selected && selected.status === '在线' && selected.default && !dirty && !shownFailure)
  const verifiedNotCurrent = Boolean(selected && selected.status === '在线' && !selected.default && !dirty && !shownFailure)

  return (
    <fieldset className="page models-page" disabled={formBusy} aria-busy={formBusy} aria-label="模型配置" style={{ border: 0, minWidth: 0 }}>
      <div className={`current-service-banner${using && !failedCurrentVerification ? ' ready' : ' pending'}`}>
        <div className="current-service-icon">{using && !failedCurrentVerification ? <CheckCircle2 size={18} /> : <PlugZap size={18} />}</div>
        <div>
          <span>{failedCurrentVerification ? '当前配置已保留' : currentOffline ? '当前服务离线' : using ? '正在使用' : '还不能聊天'}</span>
          <strong data-testid="current-service-name">{defaultModel?.name ?? '未选择默认模型'}</strong>
          <p>
            {failedCurrentVerification
              ? `${defaultModel?.model} · 本次验证未通过，连接状态待确认。检查后可以再测一次。`
              : currentOffline
              ? `${defaultModel?.model} · 最近请求未成功，配置已保留。检查网络与服务后，可以重试对话或再测一次。`
              : using
              ? `${defaultModel?.model} · 验证成功 · 响应 ${defaultModel?.latency}。左侧「交流」会走这个服务。`
              : '选服务商，贴上 API Key，点「验证并开始使用」。这里变成绿色，才算开始用。'}
          </p>
        </div>
        {failedCurrentVerification ? <Pill tone="amber">连接待确认</Pill> : currentOffline ? <Pill tone="red">离线</Pill> : <StatusPill status={using ? 'in-use' : 'not-started'} />}
        <Button size="sm" disabled={!defaultModel || verifying} onClick={() => void runFormAction('正在重新测试当前服务…', recheckCurrent)}>
          再测一次
        </Button>
      </div>

      <div className="model-layout">
        <Card className="model-list-card">
          <CardHead
            title="已保存的配置"
            subtitle="选择配置可在下方编辑，不会切换当前服务。验证并启用后，对话才会使用它。"
            aside={<Button size="sm" onClick={() => void runFormAction('正在添加配置…', addModel)} disabled={Boolean(busy['model:create'])} icon={<Plus size={15} />} aria-label="添加模型配置" data-testid="add-model">添加配置</Button>}
          />
          <div className="model-list">
            {data.models.map((model) => (
              <button
                type="button"
                key={model.id}
                data-testid="model-item"
                className={`model-list-item${model.id === selected?.id ? ' active' : ''}`}
                aria-pressed={model.id === selected?.id}
                onClick={() => chooseModel(model)}
              >
                <div className="model-list-top">
                  <strong>{model.name}</strong>
                  {model.id === failedVerificationModelId ? <Pill tone="amber">本次未通过</Pill> : model.status === '在线' ? <StatusPill status="verified" /> : <Pill tone={model.tone}>{model.status}</Pill>}
                </div>
                <p>{model.model || '未填模型'} · {hostOf(model.endpoint)}</p>
                <div className="model-list-foot">
                  <span>{model.hasKey ? '密钥已保存' : '未配置密钥'}</span>
                  {model.default ? model.status === '在线' ? <StatusPill status="in-use" /> : <Pill tone="amber">当前配置</Pill> : null}
                </div>
              </button>
            ))}
            {!data.models.length ? (
              <EmptyState
                title="还没有保存的配置"
                description="在下方选择服务商并填写连接信息，验证后会保存配置。"
              />
            ) : null}
          </div>
          <p className="fineprint"><ShieldCheck size={13} />密钥加密保存在本机，不会写进日志。</p>
        </Card>

        <Card className="model-editor-card">
          <div className="model-editor-head">
            <div>
              <h2>{selected ? '编辑配置' : '添加模型服务'}</h2>
              <p>选择服务商，确认连接信息，再验证并启用。修改后需重新验证才会生效。</p>
            </div>
            <div className="model-editor-pills">
              {readyHere ? <StatusPill status="in-use" /> : null}
              {dirty ? <StatusPill status="unverified" /> : null}
            </div>
          </div>

          <section className="model-step">
            <div className="model-step-title"><span>1</span>选择服务商</div>
            <div className="provider-grid">
              {MODEL_PRESETS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`provider-card${activePreset === item.id ? ' active' : ''}`}
                  onClick={() => applyPreset(item.id)}
                  data-testid={`model-preset-${item.id}`}
                >
                  <strong>{item.label}</strong>
                  <span>{hostOf(item.endpoint)}</span>
                </button>
              ))}
            </div>
            {preset ? <p className="model-step-note">{preset.note}</p> : null}
          </section>

          <section className="model-step">
            <div className="model-step-title"><span>2</span>确认地址、模型和密钥</div>
            <div className="form-grid">
              <Field label="配置名称">
                <Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} maxLength={80} data-testid="model-config-name" />
              </Field>
              <Field label="接口协议" hint="选了服务商后会自动对上，一般不用改。">
                <select className="select" value={draft.provider} onChange={(event) => updateDraft({ provider: event.target.value })} data-testid="model-provider">
                  {providerOptions.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
                </select>
              </Field>
              <Field label="服务地址"  hint={preset?.endpoint ? `已按${preset.label}填好，可以改。` : '兼容接口一般填到 /v1。'}>
                <Input value={draft.endpoint} onChange={(event) => updateDraft({ endpoint: event.target.value })} maxLength={500} placeholder="https://api.deepseek.com" data-testid="model-endpoint" />
              </Field>
              <Field label="模型名称"  hint="填写服务商提供的完整模型 ID，也可选择推荐模型。">
                {preset && preset.models.length > 0 ? (
                  <div className="model-choice-row">
                    {preset.models.map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        className={draft.model === model.id ? 'keyword-chip active' : 'keyword-chip'}
                        onClick={() => updateDraft({ model: model.id })}
                      >
                        {model.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Input value={draft.model} onChange={(event) => updateDraft({ model: event.target.value })} placeholder={preset?.suggestedModel || '填写模型 ID'} maxLength={200} data-testid="model-name" />
              </Field>
              <Field
                label="API Key"

                hint={preset?.needsKey === false ? '本机 Ollama 通常留空。' : selected?.hasKey ? '已经加密保存。留空表示继续用原来的密钥。' : '密钥加密保存在本机，用于向所填服务地址发送请求，不会写入日志。'}
              >
                <div className="secret-field">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={draft.key}
                    onChange={(event) => updateDraft({ key: event.target.value })}
                    maxLength={500}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={selected?.hasKey ? '已保存，留空保持不变' : '粘贴 API Key'}
                    data-testid="model-key"
                  />
                  <button type="button" className="secret-toggle" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
            </div>
          </section>

          <section className="model-step">
            <div className="model-step-title"><span>3</span>验证与启用</div>
            <div className="model-actions model-actions-primary">
              <Button
                variant="primary"
                className="model-use-button"
                onClick={() => void runFormAction('正在验证并启用配置…', verifyAndUse)}
                disabled={verifying || Boolean(busy['model:default']) || Boolean(busy['model:create'])}
                icon={verifying ? <Spinner size={14} /> : <PlugZap size={15} />}
                data-testid="verify-model"
              >
                {verifying ? '正在验证…' : '验证并开始使用'}
              </Button>
              <Button
                onClick={() => void runFormAction('正在切换当前服务…', activateSaved)}
                disabled={!selected || selected.default || selected.status !== '在线' || dirty || Boolean(busy['model:default']) || verifying}
                data-testid="set-default-model"
              >
                设为当前使用
              </Button>

            </div>
            <section className={`use-result${formBusy ? ' wait' : shownFailure ? ' bad' : readyHere ? ' ok' : verifiedNotCurrent ? ' wait' : dirty ? ' wait' : ' guide'}`}>
              {verifying ? (
                <>
                  <strong><Spinner size={14} /> 正在验证 {draft.model || '模型'}…</strong>
                  <p>{failureContext === 'current' ? '正在重新检查当前服务的连接，不会切换配置。' : `会向 ${draft.endpoint || '服务地址'} 发送测试请求，通过后自动设为当前服务。`}</p>
                </>
              ) : formBusy ? (
                <>
                  <strong><Spinner size={14} /> {formAction || '正在更新模型配置…'}</strong>
                  <p>完成后即可继续编辑。</p>
                </>
              ) : shownFailure ? (
                <>
                  <strong><AlertCircle size={16} /> {failureTitle}</strong>
                  {failureRetention ? <p>{failureRetention}</p> : null}
                  <p>{shownFailure}</p>
                </>
              ) : readyHere ? (
                <>
                  <strong><CheckCircle2 size={16} /> 验证成功，已经开始使用</strong>
                  <p>{selected?.name} · {selected?.model} · 响应 {selected?.latency}。打开左侧「交流」发一句话，就会走这个服务。</p>
                  <Button variant="primary" onClick={() => void useAppStore.getState().createConversation().then((created) => { if (created) navigate('/chat') })}>开始第一次对话</Button>
                </>
              ) : verifiedNotCurrent ? (
                <>
                  <strong>验证成功，但对话还没在用它</strong>
                  <p>点击「设为当前使用」。只有标成正在使用的配置才会接到对话。</p>
                </>
              ) : dirty && selected?.status === '在线' ? (
                <>
                  <strong>改过配置，还没生效</strong>
                  <p>再点一次「验证并开始使用」。变成绿色，才算开始用新的地址或模型。</p>
                </>
              ) : (
                <>
                  <strong>等待验证</strong>
                  <p>验证会向所填服务地址发出测试请求。通过后保存配置并设为当前服务；失败时不会切换到这条配置。</p>
                </>
              )}
            </section>

            {selected && selected.capabilities.length > 0 ? (
              <div>
                <p className="model-step-note">{dirty ? '上次验证的能力 · 当前修改尚未验证' : '上次验证的能力'}</p>
                <div className="capability-chips probed-caps">
                  {selected.capabilities.map((item) => (
                    <span key={item.id} className="cap-chip">
                      {capabilityLabel[item.id] ?? item.id} · {item.status === 'verified' ? '可用' : item.status === 'unsupported' ? '不支持' : '未确认'}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <div className="model-delete-row">
            <div><strong>删除这条配置</strong><p>移除连接信息和保存的密钥，不会删除聊天历史。</p></div>
              <Button
                variant="danger"
                onClick={() => void runFormAction('正在删除配置…', removeModel)}
                disabled={!selected || Boolean(busy['model:delete'])}
                icon={<Trash2 size={14} />}
                data-testid="delete-model"
              >
                删除
              </Button>
          </div>
        </Card>
      </div>
    </fieldset>
  )
}
