export interface FakeDisplay {
  id: number
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
}

export interface PetBounds {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export function petVisibleOnDisplay(pet: PetBounds, displays: readonly FakeDisplay[]): { displayId: number; visible: boolean } {
  const display = displays.find((item) =>
    pet.x >= item.x && pet.x < item.x + item.width && pet.y >= item.y && pet.y < item.y + item.height
  )
  if (!display || !pet.visible) return { displayId: display?.id ?? -1, visible: false }
  return { displayId: display.id, visible: true }
}

export function permissionPair(input: { screen: boolean; microphone: boolean }): { screen: '允许' | '拒绝'; microphone: '允许' | '拒绝' } {
  return {
    screen: input.screen ? '允许' : '拒绝',
    microphone: input.microphone ? '允许' : '拒绝'
  }
}
