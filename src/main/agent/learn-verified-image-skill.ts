import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { Task } from '../../shared/types'
import { resolveInside } from '../tools/filesystem'
import { findSkill, noteSkillFailure, readSkills, rememberSkill, type LocalSkill, type SkillScope } from './skills'
/** Learns only the registered deterministic image procedure. User/model text is
 * descriptive data and is never interpreted as a program. Repeated broadcasts
 * are idempotent and failure history stays within its original root scope. */
export function learnVerifiedImageSkill(dir: string, task: Task): LocalSkill | null {
  const calls = task.toolCalls.filter((call) => call.agentRole === 'Worker' && call.stepId.endsWith('-copy-image'))
  if (!calls.length) return null
  const latest = [...calls].reverse().find((call) => (call.declared.args as { phase?: string }).phase === 'result') ?? calls.at(-1)!
  const args = latest.declared.args as { hostPath?: string; procedureId?: string; sourceHash?: string }
  if (!args.hostPath) return null
  const path = resolve(args.hostPath); const root = dirname(path)
  const scope: SkillScope = { workspace: /^(desktop|桌面)$/i.test(basename(root)) ? 'desktop' : 'pictures', root }
  if (['失败', '已取消', '部分完成'].includes(task.status)) { noteSkillFailure(dir, 'draw-image', task.result || task.summary, scope, task.id); return null }
  if (task.status !== '已完成' || args.procedureId !== 'isolated-example-image-v1' || !args.sourceHash || latest.execution.status !== 'ok' || latest.verification.verdict !== 'confirmed') return null
  const hashProof = latest.verification.evidence.find((item) => item.kind === 'fs-hash' && item.matched && resolve(item.target) === path && /^[a-f0-9]{64}$/.test(item.actual) && item.actual === item.expected && item.actual === args.sourceHash)
  if (!hashProof || !task.artifacts.some((artifact) => resolve(artifact) === path)) return null
  try {
    const actual = resolveInside(root, path); if (!statSync(actual).isFile()) return null
    const bytes = readFileSync(actual)
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || createHash('sha256').update(bytes).digest('hex') !== hashProof.actual) { noteSkillFailure(dir, 'draw-image', '已交付图片在学习前发生变化，未记录为成功技能', scope, task.id); return null }
    const known = readSkills(dir).find((skill) => skill.verification?.taskId === task.id)
    if (known) return known
    // An identical registered procedure at another root remains independently
    // authorized; it must not be superseded by this success.
    const previous = findSkill(dir, 'draw-image', scope)
    return rememberSkill(dir, { id: `image-skill-${randomUUID()}`, kind: 'draw-image', procedure: 'isolated-example-image-v1', steps: '隔离生成确定性示例图片 → 独立核对原件 → 批准后排他复制 → 独立核对目标哈希', check: '原件与目标 SHA-256 一致，目标为有效的非空 PNG；每次仍须新的目标批准', allowedTools: ['filesystem'], workspace: scope.workspace, root, superseded: false, lastFailure: '', failures: previous?.failures ? [...previous.failures] : [], createdAt: new Date().toISOString() }, { taskId: task.id, status: '已完成', evidence: [hashProof] })
  } catch { return null }
}
