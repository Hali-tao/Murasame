export const PET_PRESET_IDS = ['tororo', 'whale-girl', 'naiwa'] as const

export type PetPresetId = (typeof PET_PRESET_IDS)[number]
export type PetMotionAction = 'tap' | 'drag' | 'dragUp' | 'dragDown'

export interface PetPreset {
  id: PetPresetId
  name: string
  summary: string
  modelUrl: string
  idleMotion: string
  motionCount: string
  expressionCount: string
  format: string
  source: string
  license: string
  mark: string
  tone: 'coral' | 'blue' | 'amber'
  motions: Partial<Record<PetMotionAction, string>>
}

export const PET_PRESETS: readonly PetPreset[] = [
  {
    id: 'tororo',
    name: '白猫 tororo',
    summary: '动作完整、点击反馈明确的官方示例白猫。',
    modelUrl: 'live2d/tororo/tororo.model3.json',
    idleMotion: 'Idle',
    motionCount: '9 组动作',
    expressionCount: '无独立表情',
    format: 'Cubism 4 · model3',
    source: 'Live2D 官方示例素材',
    license: 'Live2D 免费素材许可',
    mark: '猫',
    tone: 'coral',
    motions: {
      tap: 'Tap',
      drag: 'Flick',
      dragUp: 'FlickUp',
      dragDown: 'FlickDown'
    }
  },
  {
    id: 'whale-girl',
    name: '鲸鱼娘',
    summary: '带动画表情与伸展动作，模型资源结构完整。',
    modelUrl: 'live2d/whale-girl/c_0120.model3.json',
    idleMotion: 'idle',
    motionCount: '8 组动作',
    expressionCount: '44 个表情',
    format: 'Cubism 4 · model3',
    source: '上善无形 / ZipZipPipe / 氵六青',
    license: 'CC BY-NC-SA 4.0 · 非商业',
    mark: '鲸',
    tone: 'blue',
    motions: {
      tap: 'aidale'
    }
  },
  {
    id: 'naiwa',
    name: '奶龙',
    summary: '课程项目预置的黄色形象，适合轻松互动。',
    modelUrl: 'live2d/naiwa/奶蛙.model3.json',
    idleMotion: 'Idle',
    motionCount: '1 组动作',
    expressionCount: '4 个表情',
    format: 'Cubism 5 · model3',
    source: '课程项目本地资源',
    license: '仅用于本项目课程演示',
    mark: '龙',
    tone: 'amber',
    motions: {
      tap: 'Idle'
    }
  }
]

export const DEFAULT_PET_PRESET: PetPresetId = 'tororo'

export function isPetPresetId(value: unknown): value is PetPresetId {
  return typeof value === 'string' && (PET_PRESET_IDS as readonly string[]).includes(value)
}

export function getPetPreset(id: PetPresetId | string | undefined): PetPreset {
  return PET_PRESETS.find((preset) => preset.id === id) ?? PET_PRESETS[0]
}
