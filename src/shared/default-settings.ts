import type { AppSettings } from './types'
import { DEFAULT_PET_PRESET } from './pet-presets'

export const DEFAULT_PET_HOTKEY = 'Alt+`'

export const initialSettings: AppSettings = {
  startAtLogin: false,
  minimizeToTray: true,
  doNotDisturb: false,
  taskNotifications: true,
  theaterEnabled: true,
  encryptLocalData: true,
  closeBehavior: 'tray',
  logRetentionDays: 14,
  memoryEnabled: true,
  memoryAutoExtract: true,
  petVisible: true,
  petScale: 0.9,
  petPreset: DEFAULT_PET_PRESET,
  petHotkey: DEFAULT_PET_HOTKEY,
  screenHotkey: 'Ctrl+Alt+Q',
  screenCaptureMode: 'region',
  importedModelUrl: '',
  importedCharacterName: '',
  screenWatchEnabled: false,
  screenWatchSeconds: 15,
  voiceRoute: 'local',
  speakReplies: true,
  userName: '',
  outboundImages: false,
  fileApproval: 'ask',
  proactivePace: 'mid',
  onboardingDone: false,
  permissions: {
    screen: false,
    microphone: false,
    accessibility: false
  }
}
