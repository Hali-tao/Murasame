import Store from 'electron-store'
import type { AppSettings, PetState } from '../shared/types'
import { initialSettings } from '../shared/mock-data'

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
}

const store = new Store<PersistedShape>({
  name: 'murasame',
  defaults: {
    settings: initialSettings,
    pet: { x: null, y: null },
    windowBounds: null
  }
})

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
  return mergeSettings(store.get('settings'))
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
  store.set('settings', next)
  listeners.forEach((listener) => listener(next))
  return next
}

export function getPetState(): PetState {
  const settings = getSettings()
  const position = store.get('pet')
  const x = typeof position?.x === 'number' ? position.x : 0
  const y = typeof position?.y === 'number' ? position.y : 0
  return { visible: settings.petVisible, scale: settings.petScale, x, y, preset: settings.petPreset }
}

export function savePetPosition(x: number, y: number): void {
  store.set('pet', { x, y })
}

export function saveWindowBounds(bounds: { x?: number; y?: number; width: number; height: number }): void {
  store.set('windowBounds', bounds)
}

export function getWindowBounds(): PersistedShape['windowBounds'] {
  return store.get('windowBounds')
}
