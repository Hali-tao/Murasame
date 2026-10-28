import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { CreationDraft, CreationKind } from '../../shared/isolated-creation'
import { runInContainerAsync, type DockerRunner } from './docker-runtime'

export const CREATION_LIMITS = { modelCalls: 6, milliseconds: 180_000, attempts: 2, bytes: 512 * 1024 } as const
export const creationDraftSchema = z.object({ title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(24000), expectedOutput: z.string().max(4000) }).strict()
export const creationReviewSchema = z.object({ accepted: z.boolean(), reason: z.string().trim().min(1).max(2000) }).strict()
export const creationEvidenceSchema = z.object({ name: z.enum(['main.py', 'document.odt']), bytes: z.number().int().positive().max(CREATION_LIMITS.bytes), sha256: z.string().regex(/^[a-f0-9]{64}$/), base64: z.string().max(710000), text: z.string().max(30000), stdout: z.string().max(32000), stderr: z.string().max(32000), exitCode: z.number().int(), timedOut: z.boolean() }).strict()
export type CreationEvidence = z.infer<typeof creationEvidenceSchema>
export interface CreationAgents {
  modelName: string
  draft(input: { kind: CreationKind; goal: string; feedback?: string }, control: { signal: AbortSignal; beforeSend(): void }): Promise<CreationDraft>
  review(input: { kind: CreationKind; goal: string; draft: CreationDraft; evidence: Omit<CreationEvidence, 'base64'> }, control: { signal: AbortSignal; beforeSend(): void }): Promise<z.infer<typeof creationReviewSchema>>
}

/** End this workflow promptly even if its provider request is still queued.
 * The provider receives the same signal and checks it before any later send. */
export async function creationRequest<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let cancel!: () => void
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason ?? new Error('创作已停止'))
    signal.addEventListener('abort', cancel, { once: true })
  })
  try { return await Promise.race([operation(), interrupted]) }
  finally { signal.removeEventListener('abort', cancel) }
}
export function verifyCreationEvidence(kind: CreationKind, draft: CreationDraft, raw: unknown): CreationEvidence {
  const item = creationEvidenceSchema.parse(raw)
  const data = Buffer.from(item.base64, 'base64')
  if (data.toString('base64') !== item.base64 || data.length !== item.bytes || createHash('sha256').update(data).digest('hex') !== item.sha256) throw new Error('实际产物内容或哈希无法核对')
  if (item.timedOut || item.exitCode !== 0) throw new Error(`实际运行${item.timedOut ? '超时' : `失败（退出码${item.exitCode}）`}`)
  if (kind === 'code') {
    if (item.name !== 'main.py' || data.toString('utf8') !== draft.content || item.text !== draft.content) throw new Error('实际代码与候选不一致')
    if (!draft.expectedOutput.trim() || item.stdout.trim() !== draft.expectedOutput.trim()) throw new Error('实际输出与候选声明不一致')
  } else if (item.name !== 'document.odt' || data.subarray(0, 4).toString('hex') !== '504b0304' || item.text !== `${draft.title}\n${draft.content.replaceAll('\r\n', '\n')}`) throw new Error('LibreOffice文档回读与候选不一致')
  return item
}
export async function runCreation(containerId: string, activityId: string, attempt: number, kind: CreationKind, draft: CreationDraft, run: DockerRunner | undefined, signal: AbortSignal): Promise<CreationEvidence> {
  const payload = JSON.stringify({ action: 'create', activityId, attempt, kind, draft: creationDraftSchema.parse(draft) })
  const raw = await runInContainerAsync(containerId, ['python3', '-I', '/opt/murasame/creation-runner.py'], run, { signal, timeoutMs: 50_000, input: payload })
  return creationEvidenceSchema.parse(JSON.parse(raw))
}
export async function readCreation(containerId: string, activityId: string, attempt: number, kind: CreationKind, run: DockerRunner | undefined, signal: AbortSignal): Promise<CreationEvidence> {
  const payload = JSON.stringify({ action: 'read', activityId, attempt, kind })
  return creationEvidenceSchema.parse(JSON.parse(await runInContainerAsync(containerId, ['python3', '-I', '/opt/murasame/creation-runner.py'], run, { signal, timeoutMs: 8000, input: payload })))
}
