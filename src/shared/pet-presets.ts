export const PET_PRESET_IDS = ['tororo', 'whale-girl', 'naiwa', 'nailong'] as const

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
    name: '奶娃',
    summary: '连续呼吸、思考与工作动作，身体和手臂自然跟随。',
    modelUrl: 'live2d/naiwa/奶蛙.model3.json',
    idleMotion: 'Idle',
    motionCount: '10 组连续动作 · 保留原动作',
    expressionCount: '4 个表情',
    format: 'Cubism 5 · model3',
    source: '课程项目本地资源',
    license: '仅用于本项目课程演示',
    mark: '娃',
    tone: 'amber',
    motions: {
      tap: 'Greet',
      drag: 'DragLeft',
      dragUp: 'Agree',
      dragDown: 'DragRight'
    }
  },
  {
    id: 'nailong',
    name: '奶龙',
    summary: '官方渲染外观的连续网格形象，呼吸、重心、眨眼与说话口型都跟随。',
    modelUrl: 'pets/nailong/nailong_front_official_1000.png',
    idleMotion: 'Idle',
    motionCount: '网格待机 + 5 组反应动作',
    expressionCount: '眨眼 · 说话口型',
    format: 'Mesh 2D · 官方图',
    source: '第七印象官方站 www.nailoong.com',
    license: '官方素材 · 仅课程演示，不公开分发',
    mark: '龙',
    tone: 'amber',
    motions: {
      tap: 'Greet',
      drag: 'Settle',
      dragUp: 'Greet',
      dragDown: 'Settle'
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
