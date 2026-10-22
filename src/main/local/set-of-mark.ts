export interface MarkableElement {
  name: string
  controlType: string
  bounds: { x: number; y: number; width: number; height: number }
}

export interface MarkedElement extends MarkableElement {
  id: number
}

const interactive = /button|edit|hyperlink|menuitem|listitem|checkbox|radiobutton|combobox|tabitem|splitbutton/i

export function markElements(elements: readonly MarkableElement[]): MarkedElement[] {
  return elements
    .filter((element) => interactive.test(element.controlType) && element.bounds.width > 0 && element.bounds.height > 0)
    .slice(0, 32)
    .map((element, index) => ({ ...element, id: index + 1 }))
}

export function chooseLocator(input: {
  controlId: string | null
  marks: readonly MarkedElement[]
  pixel: { x: number; y: number } | null
  sourceWidth: number
  targetWidth: number
  sourceHeight: number
  targetHeight: number
}): { kind: 'control' | 'mark' | 'pixel'; target: string } {
  if (input.controlId) return { kind: 'control', target: input.controlId }
  if (input.marks.length > 0) return { kind: 'mark', target: String(input.marks[0].id) }
  const pixel = input.pixel ?? { x: 0, y: 0 }
  const x = Math.round(pixel.x * (input.targetWidth / Math.max(input.sourceWidth, 1)))
  const y = Math.round(pixel.y * (input.targetHeight / Math.max(input.sourceHeight, 1)))
  return { kind: 'pixel', target: `${x},${y}` }
}
