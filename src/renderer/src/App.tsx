import { useEffect } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { ToastHost } from './components/ToastHost'
import { useAppStore } from './store'
import { DashboardPage } from './pages/DashboardPage'
import { ChatPage } from './pages/ChatPage'
import { ScreenPage } from './pages/ScreenPage'
import { TasksPage } from './pages/TasksPage'
import { HistoryPage } from './pages/HistoryPage'
import { MemoryPage } from './pages/MemoryPage'
import { ToolsPage } from './pages/ToolsPage'
import { ModelsPage } from './pages/ModelsPage'
import { CharacterPage } from './pages/CharacterPage'
import { AutonomyPage } from './pages/AutonomyPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { SettingsPage } from './pages/SettingsPage'

export function App(): React.JSX.Element {
  const navigate = useNavigate()
  const init = useAppStore((state) => state.init)
  const loading = useAppStore((state) => state.loading)
  const startupError = useAppStore((state) => state.startupError)
  const data = useAppStore((state) => state.data)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    return window.murasame.window.onNavigated((path) => {
      const pathOnly = path.split('?')[0]
      if (pathOnly === '/tasks' || pathOnly === '/chat' || pathOnly === '/settings') navigate(path)
    })
  }, [navigate])

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">雨</div>
        <div className="boot-title">Murasame</div>
        <div className="boot-bar"><span /></div>
        <p>正在载入本地控制台…</p>
      </div>
    )
  }

  if (startupError || !data) {
    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <div className="fatal-mark">M</div>
          <h1>无法启动控制台</h1>
          <p>{startupError ?? '本地数据未载入。'}</p>
          <p className="muted">请检查安装是否完整，并尝试从开始菜单重新启动 Murasame。</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            重新尝试
          </button>
        </div>
      </div>
    )
  }

  if (!data.settings.onboardingDone) return <OnboardingPage />

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <main className="content-scroll">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/screen" element={<ScreenPage />} />
            <Route path="/autonomy" element={<AutonomyPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/character" element={<CharacterPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Routes>
        </main>
      </div>
      <ToastHost />
    </div>
  )
}
