import { createHash } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, openSync, readSync, type Stats } from 'node:fs'
import { open } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { z } from 'zod'
import { SUMMARY_LIMITS, type GroundedDraft, type SourceManifest, type SourceSnapshot } from '../../shared/grounded-summary'
import { resolveInside } from '../tools/filesystem'
import type { TaskModelBinding } from '../core/services/task-service'

export interface SummaryModelControl { signal: AbortSignal; beforeSend(): void; onDispatch(waitMs: number): void }
export type SummaryGenerator = (input: { instruction: string; sources: SourceSnapshot[] }, model: TaskModelBinding, control: SummaryModelControl) => Promise<GroundedDraft>
export const groundedWorkflowSchema = z.object({
  kind: z.literal('summarize-files'), sources: z.array(z.string().min(1).max(260)).min(1).max(SUMMARY_LIMITS.files),
  instruction: z.string().trim().min(1).max(2000), outputPath: z.string().min(1).max(260)
}).strict()
export const groundedDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sections: z.array(z.object({ text: z.string().trim().min(1).max(2000), citations: z.array(z.object({
    sourceId: z.string().regex(/^source-[1-5]$/), fromLine: z.number().int().min(1), toLine: z.number().int().min(1), quote: z.string().trim().min(1).max(240)
  }).strict()).min(1).max(5) }).strict()).min(1).max(12),
  limitations: z.array(z.string().trim().min(1).max(300)).max(8)
}).strict()
export function summaryHash(text: string | Buffer): string { return createHash('sha256').update(text).digest('hex') }
export function summaryRelativePath(path: string, output = false): string {
  if (isAbsolute(path) || /^[\\/]/.test(path) || /[:*?"<>|]/.test(path) || [...path].some(char => char.charCodeAt(0) < 32) || path.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) throw new Error('摘要只接受授权目录内明确的相对文件路径')
  if (!(output ? ['.md'] : ['.md', '.txt']).includes(extname(path).toLowerCase())) throw new Error(output ? '摘要输出必须是新的 .md 文件' : '摘要来源仅支持 UTF-8 的 .txt 或 .md 文件')
  return path.replaceAll('\\', '/')
}
function metadata(id: string, relativePath: string, stat: Stats): SourceManifest {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('摘要来源必须是普通文件，不能是目录或重解析路径')
  if (stat.size > SUMMARY_LIMITS.fileBytes) throw new Error('单份来源大小超过 32 KiB；请缩小来源后重试')
  if (stat.size === 0) throw new Error('摘要来源为空，请提供有内容的文件')
  return { id, relativePath, bytes: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, dev: stat.dev, ino: stat.ino }
}
function sameIdentity(left: SourceManifest, right: SourceManifest): boolean {
  return left.relativePath === right.relativePath && left.bytes === right.bytes && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.dev === right.dev && left.ino === right.ino
}
export function inspectSummarySources(root: string, paths: string[]): SourceManifest[] {
  if (!paths.length || paths.length > SUMMARY_LIMITS.files) throw new Error('请明确指定 1 至 5 份来源文件')
  const identities = new Set<string>(); const names = new Set<string>()
  const manifest = paths.map((path, index) => {
    const relativePath = summaryRelativePath(path)
    const meta = metadata(`source-${index + 1}`, relativePath, lstatSync(resolveInside(root, relativePath)))
    const key = `${meta.dev}:${meta.ino}`
    if (identities.has(key) || names.has(relativePath.toLowerCase())) throw new Error('来源包含重复文件或同一文件的别名')
    identities.add(key); names.add(relativePath.toLowerCase()); return meta
  })
  if (manifest.reduce((total, source) => total + source.bytes, 0) > SUMMARY_LIMITS.totalBytes) throw new Error('来源总大小超过 64 KiB；请缩小来源后重试')
  return manifest
}
function decodeSnapshot(meta: SourceManifest, bytes: Buffer): SourceSnapshot {
  if (bytes.length !== meta.bytes) throw new Error('来源读取期间发生变化，需重新批准')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (error) { throw new Error('来源不是有效的 UTF-8 文本；请先转换编码', { cause: error }) }
  if (!text.trim() || text.includes('\0')) throw new Error('来源为空或不是纯文本')
  return { ...meta, sha256: summaryHash(bytes), text, lines: text.replace(/\r\n?/g, '\n').split('\n') }
}
function assertManifest(expected: SourceManifest[], actual: SourceManifest[]): void {
  if (expected.length !== actual.length || actual.some((item, index) => !sameIdentity(expected[index], item))) throw new Error('批准后来源文件发生变化，需重新批准')
}
/** Only this bounded reader reads source contents, after source approval. */
export async function readSummarySources(root: string, paths: string[], signal: AbortSignal, expected?: SourceManifest[]): Promise<SourceSnapshot[]> {
  signal.throwIfAborted()
  const manifest = inspectSummarySources(root, paths)
  if (expected) assertManifest(expected, manifest)
  const snapshots: SourceSnapshot[] = []
  for (const meta of manifest) {
    signal.throwIfAborted()
    const handle = await open(resolveInside(root, meta.relativePath), 'r')
    try {
      if (!sameIdentity(meta, metadata(meta.id, meta.relativePath, await handle.stat()))) throw new Error('来源打开期间发生变化，需重新批准')
      const buffer = Buffer.alloc(SUMMARY_LIMITS.fileBytes + 1)
      let offset = 0
      while (offset < buffer.length) {
        signal.throwIfAborted()
        const read = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (!read.bytesRead) break
        offset += read.bytesRead
      }
      const after = metadata(meta.id, meta.relativePath, await handle.stat())
      const pathAfter = metadata(meta.id, meta.relativePath, lstatSync(resolveInside(root, meta.relativePath)))
      if (!sameIdentity(meta, after) || !sameIdentity(meta, pathAfter)) throw new Error('来源读取期间发生变化，需重新批准')
      snapshots.push(decodeSnapshot(meta, buffer.subarray(0, offset)))
    } finally { await handle.close() }
  }
  signal.throwIfAborted()
  if (snapshots.reduce((count, source) => count + [...source.text].length, 0) > SUMMARY_LIMITS.sourceChars) throw new Error('来源总字符超过 24000；请缩小来源后重试')
  return snapshots
}
/** Synchronous bounded recheck runs immediately before each actual network dispatch. */
export function assertSummarySourcesUnchanged(root: string, sources: SourceManifest[]): void {
  const manifest = inspectSummarySources(root, sources.map(source => source.relativePath))
  assertManifest(sources, manifest)
  for (const meta of sources) {
    if (!meta.sha256) continue
    const fd = openSync(resolveInside(root, meta.relativePath), 'r')
    try {
      if (!sameIdentity(meta, metadata(meta.id, meta.relativePath, fstatSync(fd)))) throw new Error('来源发生变化，需重新批准')
      const buffer = Buffer.alloc(SUMMARY_LIMITS.fileBytes + 1)
      let offset = 0
      while (offset < buffer.length) { const count = readSync(fd, buffer, offset, buffer.length - offset, offset); if (!count) break; offset += count }
      if (offset !== meta.bytes || summaryHash(buffer.subarray(0, offset)) !== meta.sha256 || !sameIdentity(meta, metadata(meta.id, meta.relativePath, fstatSync(fd))) || !sameIdentity(meta, metadata(meta.id, meta.relativePath, lstatSync(resolveInside(root, meta.relativePath))))) throw new Error('来源内容发生变化，需重新批准')
    } finally { closeSync(fd) }
  }
}
function plain(text: string): string { return text.replace(/[\\`*_{}[\]()<>#!|~]/g, '\\$&') }
export function validateAndRenderSummary(value: unknown, sources: SourceSnapshot[]): { markdown: string; sha256: string } {
  const parsed = groundedDraftSchema.safeParse(value)
  if (!parsed.success) throw new Error('摘要结构或引用不符合约定，未生成文件')
  const draft = parsed.data
  let quoteChars = 0
  const sections = draft.sections.map((section, index) => {
    const citations = section.citations.map(citation => {
      const source = sources.find(item => item.id === citation.sourceId)
      if (!source || citation.fromLine > citation.toLine || citation.toLine > source.lines.length || !source.lines.slice(citation.fromLine - 1, citation.toLine).join('\n').includes(citation.quote)) throw new Error('摘要引用无法在本次真实来源的指定行核对，未生成文件')
      quoteChars += [...citation.quote].length
      if (quoteChars > 2400) throw new Error('引用片段总量超过限制，需减少引用')
      return `> 来源：${plain(source.relativePath)}，L${citation.fromLine}–L${citation.toLine}（${source.id}）\n> ${plain(citation.quote).replaceAll('\n', '\n> ')}`
    })
    return `## ${index + 1}\n\n${plain(section.text)}\n\n${citations.join('\n\n')}`
  })
  const markdown = `# ${plain(draft.title)}\n\n${sections.join('\n\n')}${draft.limitations.length ? `\n\n## 限制与未确定事项\n\n${draft.limitations.map(item => `- ${plain(item)}`).join('\n')}` : ''}\n\n---\n引用已与本次来源快照核对；这不代表所有语义判断已获独立事实认证。\n`
  if ([...markdown].length > SUMMARY_LIMITS.draftChars) throw new Error('摘要超过 12000 字符，未生成文件')
  return { markdown, sha256: summaryHash(markdown) }
}
