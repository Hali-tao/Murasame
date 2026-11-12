import Store from 'electron-store'
import type { AppSettings, PetState } from '../shared/types'
import { initialSettings } from '../shared/default-settings'
import { advanceRelationship, blankRelationship, type RelationshipRecord } from './core/services/relationship-service'

interface PersistedShape {
  settings: AppSettings
  pet: {
    x: number | null
    y: number | null
  }
  windowBounds: {
    x?: number
    y?: number
    width: number
    height: number
  } | null
  relationship: RelationshipRecord | null
  toolEnabled: Record<string, boolean>
}

let cached: Store<PersistedShape> | null = null

/** 延迟构造 electron-store：等 app 的 userData 路径就绪后再创建，避免在模块加载阶段读取磁盘。 */
function store(): Store<PersistedShape> {
  if (!cached) {
    cached = new Store<PersistedShape>({
      name: 'murasame',
      defaults: {
        settings: initialSettings,
        pet: { x: null, y: null },
        windowBounds: null,
        relationship: null,
        toolEnabled: {}
      }
    })
  }
  return cached
}

type SettingsListener = (settings: AppSettings) => void
const listeners = new Set<SettingsListener>()

export function onSettingsChanged(listener: SettingsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const mergeSettings = (value: Partial<AppSettings> | undefined): AppSettings => ({
  ...initialSettings,
  ...(value ?? {}),
  permissions: {
    ...initialSettings.permissions,
    ...(value?.permissions ?? {})
  }
})

export function getSettings(): AppSettings {
  return mergeSettings(store().get('settings'))
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = mergeSettings({
    ...getSettings(),
    ...patch,
    permissions: {
      ...getSettings().permissions,
      ...(patch.permissions ?? {})
    }
  })
  store().set('settings', next)
  // 观察者不得回滚已提交的写入：一个监听器失败（例如广播到已销毁的窗口）不能阻断其余监听器。
  for (const listener of listeners) {
    try {
      listener(next)
    } catch {
      // 广播失败只影响该监听器自身的通知，设置已经落盘。
    }
  }
  return next
}

export function readToolEnabled(): Record<string, boolean> {
  return store().get('toolEnabled') ?? {}
}

export function writeToolEnabled(id: string, enabled: boolean): void {
  store().set('toolEnabled', { ...readToolEnabled(), [id]: enabled })
}

export function readRelationship(): RelationshipRecord {
  return store().get('relationship') ?? blankRelationship()
}

export function writeRelationship(record: RelationshipRecord): RelationshipRecord {
  store().set('relationship', record)
  return record
}

export function bumpRelationship(): RelationshipRecord {
  const current = readRelationship()
  const elapsed = Date.now() - Date.parse(current.since)
  const days = Number.isFinite(elapsed) ? Math.max(current.days, Math.floor(elapsed / 86_400_000)) : current.days
  const next = advanceRelationship({ ...current, turns: current.turns + 1, days })
  return writeRelationship(next)
}

export function getPetState(): PetState {
  const settings = getSettings()
  const position = store().get('pet')
  const x = typeof position?.x === 'number' ? position.x : 0
  const y = typeof position?.y === 'number' ? position.y : 0
  return { visible: settings.petVisible, scale: settings.petScale, x, y, preset: settings.petPreset, importedModelUrl: settings.importedModelUrl }
}

export function savePetPosition(x: number, y: number): void {
  store().set('pet', { x, y })
}

export function getSavedPetPosition(): { x: number; y: number } | null {
  const position = store().get('pet')
  return typeof position?.x === 'number' && typeof position?.y === 'number' ? { x: position.x, y: position.y } : null
}

export function saveWindowBounds(bounds: { x?: number; y?: number; width: number; height: number }): void {
  store().set('windowBounds', bounds)
}

export function getWindowBounds(): PersistedShape['windowBounds'] {
  return store().get('windowBounds')
}
