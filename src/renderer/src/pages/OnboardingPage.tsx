import { useState } from 'react'
import { Button, Card, CardHead } from '../components/ui'
import { useAppStore } from '../store'

const steps = [
  {
    title: '先认识这几个词',
    body: '历史是对话原文。长期记忆是从对话里留下的稳定偏好，两者分开清除。任务要你确认后才执行。自主活动只在隔离桌面里进行，Docker 没开时不会去控制你正在用的窗口。模型配置可以以后再换，不用重建角色和记忆。'
  },
  {
    title: '角色形象',
    body: '可以先用内置形象。导入的资源如果缺贴图或是旧格式，会拒绝并保留现在这个。声音和屏幕都可以先不授权。'
  },
  {
    title: '模型服务',
    body: '到模型服务填写地址和密钥后要先验证。没验证通过的能力不会被拿来用。拒绝配置模型时，历史、显示和设置仍然可用。'
  },
  {
    title: '权限',
    body: '屏幕读取和麦克风都可以拒绝。拒绝之后，打字、看历史、隐藏和退出都还在。屏幕里的文字只当作观察，不会变成指令。'
  }
]

export function OnboardingPage(): React.JSX.Element {
  const updateSettings = useAppStore((state) => state.updateSettings)
  const saveCharacter = useAppStore((state) => state.saveCharacter)
  const data = useAppStore((state) => state.data)
  const [index, setIndex] = useState(0)
  const [characterName, setCharacterName] = useState(data?.character.name ?? '')
  const [userName, setUserName] = useState(data?.settings.userName ?? '')
  const step = steps[index]

  const finish = async (): Promise<void> => {
    if (data && characterName.trim()) {
      await saveCharacter({ ...data.character, name: characterName.trim() })
    }
    await updateSettings({ onboardingDone: true, userName: userName.trim() })
  }

  return (
    <div className="boot-screen">
      <Card>
        <CardHead title="开始使用" subtitle={`第 ${index + 1} / ${steps.length} 步`} />
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {index === 1 ? (
          <label className="field">角色名字
            <input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="不填就用形象自带的名字" />
          </label>
        ) : null}
        {index === steps.length - 1 ? (
          <label className="field">怎么称呼你
            <input value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="可以先不填" />
          </label>
        ) : null}
        <div className="editor-actions">
          <Button onClick={() => void finish()}>跳过</Button>
          {index < steps.length - 1 ? (
            <Button variant="primary" onClick={() => setIndex((value) => value + 1)}>下一步</Button>
          ) : (
            <Button variant="primary" onClick={() => void finish()}>完成</Button>
          )}
        </div>
      </Card>
    </div>
  )
}
