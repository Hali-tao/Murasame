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
  return {
    ...box,
    x: Math.min(Math.max(box.x, display.x), display.x + Math.max(0, display.width - box.width)),
    y: Math.min(Math.max(box.y, display.y), display.y + Math.max(0, display.height - box.height))
  }
}

export function recoverPosition(box: WindowBox, displays: readonly WorkArea[]): WindowBox {
  if (displays.length === 0) return box
  const current = displayContaining(box, displays)
  const target = current ?? displays[0]
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
