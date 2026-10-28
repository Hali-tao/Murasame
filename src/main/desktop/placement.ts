export interface WorkArea {
  id: string
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
}

export interface WindowBox {
  x: number
  y: number
  width: number
  height: number
}

export function displayContaining(box: WindowBox, displays: readonly WorkArea[]): WorkArea | null {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return displays.find((display) => cx >= display.x && cx < display.x + display.width && cy >= display.y && cy < display.y + display.height) ?? null
}

export function scaleSize(width: number, height: number, fromScale: number, toScale: number): { width: number; height: number } {
  const ratio = (fromScale || 1) / (toScale || 1)
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

export function clampToDisplay(box: WindowBox, display: WorkArea): WindowBox {
  const x = Math.min(Math.max(box.x, display.x), display.x + Math.max(0, display.width - box.width))
  const y = Math.min(Math.max(box.y, display.y), display.y + Math.max(0, display.height - box.height))
  return {
    ...box,
    x: Math.round(x),
    y: Math.round(y)
  }
}

export function recoverPosition(box: WindowBox, displays: readonly WorkArea[]): WindowBox {
  if (displays.length === 0) return box
  const current = displayContaining(box, displays)
  const overlap = (display: WorkArea): number =>
    Math.max(0, Math.min(box.x + box.width, display.x + display.width) - Math.max(box.x, display.x)) *
    Math.max(0, Math.min(box.y + box.height, display.y + display.height) - Math.max(box.y, display.y))
  const distance = (display: WorkArea): number => {
    const x = Math.max(display.x - box.x - box.width, box.x - display.x - display.width, 0)
    const y = Math.max(display.y - box.y - box.height, box.y - display.y - display.height, 0)
    return x * x + y * y
  }
  const target = current ?? [...displays].sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b))[0]
  return clampToDisplay(box, target)
}

/** 对话框贴在角色旁边；靠屏幕边缘时换到空间更大的一侧。 */
export function choosePetChatSide(input: {
  characterX: number
  characterWidth: number
  chatWidth: number
  areaX: number
  areaWidth: number
}): 'left' | 'right' {
  const spaceRight = input.areaX + input.areaWidth - (input.characterX + input.characterWidth)
  const spaceLeft = input.characterX - input.areaX
  if (spaceRight >= input.chatWidth) return 'right'
  if (spaceLeft >= input.chatWidth) return 'left'
  return spaceRight >= spaceLeft ? 'right' : 'left'
}

export function resetAnchor(box: WindowBox, displays: readonly WorkArea[]): WindowBox {
  const current = displayContaining(box, displays) ?? displays[0]
  if (!current) return box
  return {
    ...box,
    x: current.x + current.width - box.width - 24,
    y: current.y + current.height - box.height - 24
  }
}
