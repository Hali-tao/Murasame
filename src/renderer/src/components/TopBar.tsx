import { Eye, EyeOff, PanelTopClose } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppStore } from '../store'
import { clockLabel, dateLabel } from '../lib/utils'
import { IconButton, Pill } from './ui'
import { pageMeta } from './navigation'

export function TopBar(): React.JSX.Element {
  const location = useLocation()
  const [now, setNow] = useState(new Date())
  const [petVisible, setPetVisible] = useState(true)
  const models = useAppStore((state) => state.data?.models ?? [])
  const notify = useAppStore((state) => state.notify)
  const current = pageMeta.find((item) => item.to === location.pathname) ?? pageMeta[0]
  const defaultModel = models.find((model) => model.default)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    void window.murasame?.pet.getState().then((state) => setPetVisible(state.visible))
    const unsubscribe = window.murasame?.pet.onStateChanged((state) => setPetVisible(state.visible))
    return () => {
      window.clearInterval(timer)
      unsubscribe?.()
    }
  }, [])

  const togglePet = async (): Promise<void> => {
    try {
      const state = await window.murasame.pet.toggle()
      setPetVisible(state.visible)
      notify(state.visible ? '桌宠已显示' : '桌宠已隐藏', 'gray')
    } catch {
      notify('桌宠窗口暂不可用', 'red')
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <h1>{current.label}</h1>
        <p>{current.subtitle}</p>
      </div>
      <div className="topbar-actions">
        <span className="topbar-time">{clockLabel(now)} · {dateLabel(now)}</span>
        <Pill tone={defaultModel?.status === '在线' ? 'green' : 'amber'} className="service-pill">
          <i className="tiny-dot" />
          模型服务{defaultModel?.status === '在线' ? '在线' : '待验证'}
        </Pill>
        <IconButton label={petVisible ? '隐藏桌宠' : '显示桌宠'} onClick={() => void togglePet()}>
          {petVisible ? <Eye size={17} /> : <EyeOff size={17} />}
        </IconButton>
        <button
          type="button"
          className="btn btn-secondary btn-sm tray-button"
          data-testid="hide-to-tray"
          onClick={() => void window.murasame.app.hideToTray()}
        >
          <PanelTopClose size={15} />
          隐藏到托盘
        </button>
      </div>
    </header>
  )
}
