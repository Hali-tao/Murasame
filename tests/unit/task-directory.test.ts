import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { extractRoot, type TaskPlan } from '../../src/main/agent/executor'
import { TaskService } from '../../src/main/core/services/task-service'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ taskNotifications: false }) }))
const databases: DatabaseSync[] = []; const folders: string[] = []
afterEach(() => { databases.splice(0).forEach(db => db.close()); folders.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })) })
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db)
  for (const migration of ['001_init.sql', '002_memory.sql', '003_trace.sql']) db.exec(readFileSync(`src/main/data/migrations/${migration}`, 'utf8'))
  const root = mkdtempSync(join(tmpdir(), 'task-directory-')); folders.push(root); writeFileSync(join(root, 'a.txt'), 'independent fixture')
  const tasks = new TaskService(db as unknown as SqliteDatabase)
  return { db, root, tasks }
}
function organize(root?: string): TaskPlan { return { tool: 'filesystem', root, steps: [{ id: 'sort', title: '按类型整理', detail: '', expected: '', args: { action: 'organize' } }], question: '' } }

describe('Windows task directory boundaries', () => {
  it.each(['E:\\', 'E:/'])('[FR-16] 保留盘符根目录 %s，不能变为驱动器相对路径', path => {
    expect(extractRoot(`整理 ${path}`)).toBe('E:\\')
  })
  it('[FR-16] 按出现顺序解析目标，不让后面的引号输出目录取代前面的工作目录', () => {
    expect(extractRoot('整理 E:\\input，并另存到 "E:\\output notes"')).toBe('E:\\input')
  })
  it('[FR-16] 支持含空格的明确引号目录和中文引号', () => {
    expect(extractRoot('整理 “E:/my notes/”')).toBe('E:\\my notes')
  })
  it('[FR-16] 同一目录不同斜线、大小写和尾分隔符仍为同一授权范围', async () => {
    const f = fixture(); f.tasks.setPlanner(async () => organize(f.root.replaceAll('\\', '/').toLowerCase() + '/'))
    const result = await f.tasks.create(`按类型整理 ${f.root}`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('等待批准')
  })
  it('[FR-18] 没有明确目录前不相对进程目录读取产物或生成哈希基线', async () => {
    const f = fixture(); const output = relative(process.cwd(), join(f.root, 'a.txt'))
    f.tasks.setPlanner(async () => ({ tool: 'terminal', root: f.root, steps: [{ id: 'build', title: '构建报告', detail: '', expected: '', outputs: [{ path: output, overwrite: true }], args: { executable: 'true' } }], question: '' }))
    const result = await f.tasks.create('构建资料报告')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.status).toBe('待确认'); expect(result.data.scope).toBe('')
    const stored = f.db.prepare('SELECT plan_json FROM task_execution_plans WHERE task_id = ?').get(result.data.id) as { plan_json: string }
    expect(JSON.parse(stored.plan_json).steps[0].outputs[0]).not.toHaveProperty('baselineHash')
    expect(readFileSync(join(f.root, 'a.txt'), 'utf8')).toBe('independent fixture')
  })
  it('[FR-16] 原生选择的目录单独传入计划器、审批和执行，不必用户抄写路径', async () => {
    const f = fixture(); let plannedGoal = ''
    f.tasks.setPlanner(async goal => { plannedGoal = goal; return organize(f.root) })
    const result = await f.tasks.create('按类型整理这些资料', f.root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(plannedGoal).toContain(f.root)
    expect(result.data.title).toBe('按类型整理这些资料')
    expect(result.data.scope).toBe(f.root); expect(result.data.approval?.target).toBe(f.root)
    expect(existsSync(join(f.root, '文档/a.txt'))).toBe(false)
    await f.tasks.approve(result.data.id); await f.tasks.settled(result.data.id)
    expect(f.tasks.list()[0].status).toBe('已完成')
    expect(readFileSync(join(f.root, '文档/a.txt'), 'utf8')).toBe('independent fixture')
  })
  it.each(['E:', '\\Windows', '\\\\?\\C:\\', 'relative'])('[FR-18] 拒绝含糊或设备目录 %s，不调用模型', async path => {
    const f = fixture(); let planned = false
    f.tasks.setPlanner(async () => { planned = true; return organize(f.root) })
    expect((await f.tasks.create('按类型整理', path)).ok).toBe(false)
    expect(planned).toBe(false)
  })
  it('[FR-18] 选择的对象必须是实际目录，不能把文件当根目录', async () => {
    const f = fixture(); let planned = false
    f.tasks.setPlanner(async () => { planned = true; return organize(f.root) })
    expect((await f.tasks.create('按类型整理', join(f.root, 'a.txt'))).ok).toBe(false)
    expect(planned).toBe(false)
  })
  it('[FR-18] 模型不能替换用户从目录选择器确认的目录', async () => {
    const f = fixture(); const other = fixture()
    f.tasks.setPlanner(async () => organize(other.root))
    const result = await f.tasks.create('按类型整理', f.root)
    expect(result.ok).toBe(false); expect(f.tasks.list()).toHaveLength(0)
  })
  it('[FR-18] 补充明确目录时也核对模型范围，拒绝后保留原计划与范围', async () => {
    const f = fixture(); const other = fixture(); f.tasks.setPlanner(async () => organize(f.root))
    const result = await f.tasks.create(`按类型整理 ${f.root}`); if (!result.ok) throw new Error(result.error)
    await f.tasks.deny(result.data.id)
    f.tasks.setPlanner(async () => organize(other.root))
    const continued = await f.tasks.continueTask(result.data.id, `仍使用 "${f.root}"，按类型整理`)
    expect(continued.ok).toBe(false)
    expect(f.tasks.list()[0].scope).toBe(f.root)
    const stored = f.db.prepare('SELECT plan_json FROM task_execution_plans WHERE task_id = ?').get(result.data.id) as { plan_json: string }
    expect(JSON.parse(stored.plan_json).root).toBe(f.root)
    expect(existsSync(join(f.root, '文档/a.txt'))).toBe(false)
  })
})
