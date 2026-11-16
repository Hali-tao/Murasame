import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, CardHead, Field, Input } from '../components/ui'
import { useAppStore } from '../store'

const steps = [
  {
    label: '认识功能', title: '先看看，你可以在这里做什么',
    body: '这一页是功能地图，不需要填写或开启任何东西。',
    items: [
      ['交流与历史', '在「交流」里打字聊天，到「历史」里找回对话原文。'],
      ['长期记忆', '保存从对话中留下的稳定偏好，可查看、更正或删除；与历史分开清除。'],
      ['任务', '让伙伴协助处理具体事情。任务要你确认，写文件等敏感操作还会单独请求批准。'],
      ['自主活动', '在独立的隔离桌面里活动。需要 Docker（运行隔离环境的软件）；未就绪时不会改为控制你正在用的窗口。']
    ],
    hint: '现在只需了解区别，接下来可以给伙伴起个名字。', next: '下一步：设置称呼'
  },
  {
    label: '设置称呼', title: '你们想怎么称呼彼此？',
    body: '称呼都可以以后修改；留空也能继续。',
    items: [
      ['先用内置形象', '进入后可到「角色设置」更换形象。导入资源缺贴图或格式不支持时，会保留当前形象。']
    ],
    hint: '填好称呼，或直接继续了解聊天需要的模型服务。', next: '下一步：了解模型服务'
  },
  {
    label: '了解模型', title: '连接模型后，伙伴才能回答你',
    body: '模型服务负责生成回答。这里先说明流程，引导结束后再去填写。',
    items: [
      ['1 · 准备连接信息', '从你使用的模型服务获取服务地址、API Key（访问密钥）和模型名称。本地服务按页面提示填写。'],
      ['2 · 填写并验证', '到「模型服务」输入信息，点击「验证并开始使用」。验证通过后，再进入交流页聊天。'],
      ['3 · 随时更换', '以后可以换模型，不需要重建角色或记忆。暂不配置也能查看历史、显示桌宠和调整设置。']
    ],
    hint: '现在不需要填写密钥。下一步了解权限，再决定是否前往配置。', next: '下一步：了解权限'
  },
  {
    label: '了解权限', title: '屏幕和麦克风，由你决定是否开启',
    body: '本页只做说明，不会申请或开启权限。以后需要时再到「运行与隐私」设置。',
    items: [
      ['屏幕读取 · 可选', '用于观察你允许读取的屏幕内容。屏幕里的文字只当作观察，不会变成执行指令；截图发给模型还需要单独授权。'],
      ['麦克风 · 可选', '用于语音输入，还需要本地语音模型。不开启也能使用文字输入。'],
      ['可以先都不开', '拒绝之后，打字、看历史、隐藏和退出仍然可用。聊天仍需已验证的模型服务。']
    ],
    hint: '准备好连接模型就前往配置；想先看看界面，也可以直接进入概览。', next: ''
  }
]

export function OnboardingPage(): React.JSX.Element {
  const navigate = useNavigate()
  const updateSettings = useAppStore((state) => state.updateSettings)
  const saveCharacter = useAppStore((state) => state.saveCharacter)
  const data = useAppStore((state) => state.data)
  const [index, setIndex] = useState(0)
  const [characterName, setCharacterName] = useState(data?.character.name ?? '')
  const [userName, setUserName] = useState(data?.settings.userName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const step = steps[index]

  const finish = async (configure = false): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      if (data && characterName.trim()) {
        const saved = await saveCharacter({ ...data.character, name: characterName.trim(), style: data.character.style.trim() || '自然、简洁' })
        if (!saved) { setError('伙伴名字未能保存，请重试；也可以清空名字后继续。'); return }
      }
      if (!await updateSettings({ onboardingDone: true, userName: userName.trim() })) {
        setError('引导设置未能保存，请重试。')
        return
      }
      navigate(configure ? '/models?setup=1' : '/')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="onboarding-screen">
      <Card className="onboarding-card" aria-label="开始使用引导">
        <CardHead title="开始使用" subtitle={`第 ${index + 1} / ${steps.length} 步`} />
        <ol className="onboarding-progress" aria-label="引导进度">
          {steps.map((item, position) => <li key={item.label} aria-current={position === index ? 'step' : undefined} className={position < index ? 'complete' : ''}>
            <span>{position + 1}</span>{item.label}
          </li>)}
        </ol>
        <section className="onboarding-content" aria-labelledby="onboarding-title" aria-live="polite">
          <h1 id="onboarding-title">{step.title}</h1>
          <p className="onboarding-intro">{step.body}</p>
          <dl className={`onboarding-topics${index === 0 ? ' onboarding-topics-grid' : ''}`}>
            {step.items.map(([title, description]) => <div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}
          </dl>
        {index === 1 ? (
          <div className="onboarding-fields">
            <Field label="伙伴的名字（可选）" hint={data?.character.style ? '留空则保留当前名字和交流风格。' : '填写名字后先用「自然、简洁」的交流风格，以后可改。'}><Input disabled={saving} value={characterName} onChange={(event) => setCharacterName(event.target.value)} maxLength={40} placeholder="留空则保留当前名字" /></Field>
            <Field label="希望伙伴怎么称呼你（可选）" hint="可以先不填，以后再设置。"><Input disabled={saving} value={userName} onChange={(event) => setUserName(event.target.value)} maxLength={40} placeholder="你的称呼" /></Field>
          </div>
        ) : null}
          <p className="onboarding-hint"><strong>接下来</strong>{step.hint}</p>
        </section>
        <footer className="onboarding-footer">
          {error ? <p role="alert">{error}</p> : null}
          <p>进入概览会结束引导并保存已填称呼，不会自动连接模型或开启权限。</p>
          <div className="onboarding-actions">
          <Button disabled={saving} variant="ghost" onClick={() => void finish()}>{index === steps.length - 1 ? '暂不配置，进入概览' : '跳过引导，进入概览'}</Button>
          <div>
          {index > 0 ? <Button disabled={saving} onClick={() => setIndex(value => value - 1)}>上一步</Button> : null}
          {index < steps.length - 1 ? (
            <Button disabled={saving} variant="primary" onClick={() => setIndex((value) => value + 1)}>{step.next}</Button>
          ) : (
            <Button disabled={saving} variant="primary" onClick={() => void finish(true)}>前往模型配置</Button>
          )}
          </div>
          </div>
        </footer>
      </Card>
    </main>
  )
}
