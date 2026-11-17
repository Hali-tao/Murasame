import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'

const parser = unified().use(remarkParse).use(remarkMath)
const literalTypes = new Set(['code', 'inlineCode', 'html', 'link', 'image', 'definition', 'math', 'inlineMath'])
interface Node {
  type: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: Node[]
}

/** Normalize model-style LaTeX delimiters before CommonMark consumes their backslashes.
 * Use Markdown source ranges to preserve code (including unfinished fences), URLs and existing math.
 * The stored/copied message is never changed.
 */
export function normalizeMathDelimiters(source: string): string {
  if (!/\\[[(]/.test(source)) return source
  const literals: Array<[number, number]> = []
  const collect = (node: Node): void => {
    if (literalTypes.has(node.type) && node.position) {
      literals.push([node.position.start.offset!, node.position.end.offset!])
    } else node.children?.forEach(collect)
  }
  collect(parser.parse(source))
  return source.replace(/\\\[([\s\S]*?)\\\]|\\\(([^\n]*?)\\\)/g, (match: string, block: string | undefined, inline: string | undefined, offset: number) => {
    let precedingSlashes = 0
    for (let i = offset - 1; i >= 0 && source[i] === '\\'; i--) precedingSlashes++
    if (precedingSlashes % 2 || literals.some(([start, end]) => offset < end && offset + match.length > start)) return match
    if (block === undefined) return `$${inline}$`
    // Keep the surrounding list/blockquote indentation when adding display-math lines.
    const linePrefix = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset)
    const indent = /^[ >]*$/.test(linePrefix) ? linePrefix : ''
    const before = /^[ >]*$/.test(linePrefix) ? '' : '\n\n'
    const opening = block.startsWith('\n') ? '' : `\n${indent}`
    const closing = /\n[ >]*$/.test(block) ? '' : `\n${indent}`
    return `${before}$$${opening}${block}${closing}$$\n`
  })
}
