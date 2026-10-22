import { NavLink } from 'react-router-dom'
import { navigation } from './navigation'
import { useAppStore } from '../store'
import { initials } from '../lib/utils'

export function Sidebar(): React.JSX.Element {
  const character = useAppStore((state) => state.data?.character)
  const busy = useAppStore((state) => state.busy)
  const activeWork = useAppStore((state) =>
    state.data?.tasks.some((task) => task.status === '执行中' || task.status === '等待批准')
  )
  const characterName = character?.name?.trim() || '未命名'

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">m</div>
        <div className="brand-copy">
          <div className="brand-title">murasame</div>
          <div className="brand-subtitle">桌面伙伴</div>
        </div>
      </div>

      <nav className="nav" aria-label="主导航">
        {navigation.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  data-testid={item.testId}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={17} strokeWidth={1.75} />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="profile-chip">
          <div className="profile-avatar">{initials(characterName)}</div>
          <div className="profile-copy">
            <strong>{characterName}</strong>
            <span><i className={busy['chat:send'] ? 'status-dot thinking' : 'status-dot'} />{activeWork ? '任务运行中 · 本地加密' : '运行中 · 本地加密'}</span>
          </div>
        </div>
        <div className="version-line">v0.9.0 · 本机运行</div>
      </div>
    </aside>
  )
}
