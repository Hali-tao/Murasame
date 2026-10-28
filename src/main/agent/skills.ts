import type { Evidence } from '../../shared/evidence'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface LocalSkill {
  id: string
  kind: 'draw-image'
  procedure?: 'isolated-example-image-v1'
  steps: string
  check: string
  /** 这条做法允许用的工具。不能超出本次任务单。 */
  allowedTools: string[]
  /** isolation 只在隔离环境里写。pictures 仍要批准后才拷到图片文件夹。 */
  workspace: 'isolation' | 'pictures' | 'desktop'
  superseded: boolean
  failures?: Array<{ reason: string; at: string; taskId?: string }>
  lastFailure: string
  root?: string
  verification?: SkillVerification
  createdAt: string
}

export interface SkillVerification { taskId: string; status: '已完成'; evidence: Evidence[] }

function fileOf(dir: string): string {
  return join(dir, 'skills.json')
}

export function readSkills(dir: string): LocalSkill[] {
  try {
    const parsed = JSON.parse(readFileSync(fileOf(dir), 'utf8')) as LocalSkill[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(dir: string, skills: LocalSkill[]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(fileOf(dir), JSON.stringify(skills, null, 2), 'utf8')
}

export interface SkillScope { workspace: LocalSkill['workspace']; root?: string }
function sameRoot(left?: string, right?: string): boolean { return left === undefined || right === undefined ? left === right : resolve(left).toLowerCase() === resolve(right).toLowerCase() }
export function findSkill(dir: string, kind: LocalSkill['kind'], scope?: SkillScope): LocalSkill | null {
  const matches = readSkills(dir).filter((item) => item.kind === kind && !item.superseded && item.verification?.status === '已完成' && (!scope || item.workspace === scope.workspace && sameRoot(item.root, scope.root)))
  return matches.at(-1) ?? null
}

/** 旧做法标成被取代，不删掉，方便追溯。 */
export function rememberSkill(dir: string, skill: LocalSkill, verification?: SkillVerification): LocalSkill {
  if (!verification?.taskId || verification.status !== '已完成' || !verification.evidence.length || !verification.evidence.every((item) => item.matched)) throw new Error('技能必须来自已核验成功的任务')
  const next = readSkills(dir).map((item) => (
    item.kind === skill.kind && item.workspace === skill.workspace && sameRoot(item.root, skill.root) && !item.superseded ? { ...item, superseded: true } : item
  ))
  const stored = { ...skill, verification, superseded: false, lastFailure: skill.lastFailure ?? '' }
  next.push(stored)
  writeAll(dir, next)
  return stored
}

export function noteSkillFailure(dir: string, kind: LocalSkill['kind'], reason: string, scope?: SkillScope, taskId?: string): void {
  const skills = readSkills(dir)
  const current = [...skills].reverse().find((item) => item.kind === kind && !item.superseded && (!scope || item.workspace === scope.workspace && sameRoot(item.root, scope.root)))
  if (!current) return
  if (taskId && current.failures?.some((failure) => failure.taskId === taskId)) return
  current.lastFailure = reason
  current.failures = [...(current.failures ?? []), { reason, at: new Date().toISOString(), taskId }]
  writeAll(dir, skills)
}

/** 技能里的工具必须是这次允许的子集。越出范围就不用它。 */
export function skillFits(skill: LocalSkill, allowedTools: readonly string[], scope?: { workspace: LocalSkill['workspace']; root?: string }): boolean {
  if (skill.superseded || !skill.verification || !scope || scope.workspace !== skill.workspace || (skill.root && !sameRoot(skill.root, scope.root))) return false
  if (skill.allowedTools.length === 0) return false
  return skill.allowedTools.every((tool) => allowedTools.includes(tool))
}
