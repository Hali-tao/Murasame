export interface PlatformCapability {
  id: string
  label: string
  windows: '可用' | '部分' | '不可用'
  other: '不可用'
  note: string
}

export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
  { id: 'chat', label: '文字交流', windows: '可用', other: '不可用', note: '本阶段只承诺 Windows 10/11 x64' },
  { id: 'screen', label: '屏幕采集', windows: '部分', other: '不可用', note: '依赖 Windows UI Automation 与系统 OCR' },
  { id: 'voice', label: '语音', windows: '部分', other: '不可用', note: '本地模型缺失时使用 Windows 语音并标明降级' },
  { id: 'isolation', label: '自主活动', windows: '部分', other: '不可用', note: '需要本机 Docker，不可用时不改去控制宿主' }
]

export function capabilityOn(platform: string, id: string): string {
  const item = PLATFORM_CAPABILITIES.find((entry) => entry.id === id)
  if (!item) return '不可用'
  return platform === 'win32' ? item.windows : '不可用'
}
