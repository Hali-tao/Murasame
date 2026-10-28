export interface AvatarCapability {
  id: string
  motions: string[]
  motionFiles: number
  expressions: string[]
  expressionFiles: number
  parameters: Array<'mouth' | 'eye' | 'head' | 'breath'>
}

export const AVATAR_CAPABILITIES: Record<string, AvatarCapability> = {
  tororo: {
    id: 'tororo',
    motions: ['Idle', 'FlickUp', 'FlickDown', 'Tap', 'Flick'],
    motionFiles: 9,
    expressions: [],
    expressionFiles: 0,
    parameters: ['mouth', 'eye', 'head', 'breath']
  },
  'whale-girl': {
    id: 'whale-girl',
    motions: ['idle', 'aidale', 'selfie', 'selfieQuick', 'ketchup', 'openLid', 'bubble', 'splash'],
    motionFiles: 8,
    expressions: ['开心兴奋', '悲伤', '问号', '感叹号', '调皮', '脸红', '爱心眼', '生气'],
    expressionFiles: 44,
    parameters: ['mouth', 'eye', 'head', 'breath']
  },
  naiwa: {
    id: 'naiwa',
    motions: ['Idle', 'Greet', 'Think', 'Agree', 'Confused', 'DragLeft', 'DragRight', 'Working', 'WorkingLoop', 'Comfort', 'LegacyIdle'],
    motionFiles: 11,
    expressions: ['dan', 'pengfu', 'sikao', 'expression1'],
    expressionFiles: 4,
    parameters: ['mouth', 'eye', 'head', 'breath']
  }
}

export function capabilityOf(id: string): AvatarCapability {
  return AVATAR_CAPABILITIES[id] ?? { id, motions: [], motionFiles: 0, expressions: [], expressionFiles: 0, parameters: [] }
}

export function canPerform(id: string, motion: string, expression: string | null): { motion: boolean; expression: boolean } {
  const capability = capabilityOf(id)
  return {
    motion: capability.motions.includes(motion),
    expression: expression ? capability.expressions.includes(expression) : false
  }
}
