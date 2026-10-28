import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PetActivitySource } from '../../src/shared/pet-activity'
import type { ActivityStatus } from '../../src/shared/types'
import type { CreationArtifact } from '../../src/shared/isolated-creation'
import { derivePetWork, petWorkMotion, type PetWorkState } from '../../src/shared/pet-work'

const artifact: CreationArtifact = { id: 'artifact-1', kind: 'code', title: '实际脚本', name: 'main.py', sha256: 'synthetic', bytes: 9, preview: 'print(42)', stdout: '42', review: '核验通过', attempt: 1 }
const activity = (patch: Partial<ActivityStatus> & { activityId?: string } = {}): ActivityStatus => ({ running: true, reason: '隔离活动已启动', viewUrl: '', notes: [], taskStatus: '', kind: 'code', phase: 'running', ...patch })
const task = (id: string, status: PetActivitySource['status'], patch: Partial<PetActivitySource> = {}): PetActivitySource => ({ id, status, title: id, summary: '', result: '', approval: null, ...patch })
const derive = (patch: Partial<Parameters<typeof derivePetWork>[0]> = {}) => derivePetWork({ tasks: [], dismissed: new Set(), sending: false, autonomy: null, ...patch })

describe('宠物真实工作状态', () => {
  it('keeps confirmation above sending, active tasks and active isolation even if dismissed', () => {
    const work = derive({ sending: true, tasks: [task('run', '执行中'), task('approval /?#', '等待批准', { approval: { target: '文件', impact: '会写入文档' } })], dismissed: new Set(['approval /?#']), autonomy: activity() })
    expect(work).toMatchObject({ source: 'task', phase: 'waiting', busy: false, label: '等你确认', detail: '会写入文档', targetPath: '/tasks?focus=approval%20%2F%3F%23' })
    expect(work?.key).toContain('approval /?#')
  })

  it('places sending above execution, but execution above isolation and old failures', () => {
    const options = { tasks: [task('old', '失败'), task('run', '执行中')], autonomy: activity({ creation: { phase: 'reviewing', message: '检查脚本输出' } }) }
    expect(derive({ ...options, sending: true })).toMatchObject({ source: 'chat', phase: 'waiting', busy: true, targetPath: '/chat' })
    expect(derive(options)).toMatchObject({ source: 'task', phase: 'working', label: '正在执行' })
    expect(derive({ ...options, tasks: [task('old', '失败')] })).toMatchObject({ source: 'autonomy', phase: 'reviewing' })
  })

  it.each([
    ['正在停止', 'stopping', '正在停止'], ['执行中', 'working', '正在执行'],
    ['规划中', 'waiting', '正在规划'], ['已确认', 'waiting', '等待执行']
  ] as const)('maps active task %s without claiming completion', (status, phase, label) => {
    expect(derive({ tasks: [task('active', status)], dismissed: new Set(['active']) })).toMatchObject({ source: 'task', phase, label, busy: true })
  })

  it('retains partial and interrupted wording and hides dismissed or cancelled terminal tasks', () => {
    expect(derive({ tasks: [task('partial', '部分完成', { result: '3 个文件中完成 2 个' })] })).toMatchObject({ phase: 'ready', label: '做了一部分', detail: '3 个文件中完成 2 个', busy: false })
    expect(derive({ tasks: [task('cut', '已中断')] })).toMatchObject({ phase: 'failed', label: '任务已中断' })
    expect(derive({ tasks: [task('done', '已完成'), task('failed', '失败')], dismissed: new Set(['done', 'failed']) })).toBeNull()
    expect(derive({ tasks: [task('cancelled', '已取消')] })).toBeNull()
  })

  it('uses actual creation phases and gives each activity its own key', () => {
    const drafting = derive({ autonomy: activity({ activityId: 'run-a', creation: { phase: 'drafting', message: '模型正在生成草稿' } }) })
    const executing = derive({ autonomy: activity({ activityId: 'run-a', creation: { phase: 'executing', message: '实际运行 main.py' } }) })
    expect(drafting).toMatchObject({ phase: 'waiting', label: '等待创作内容', detail: '模型正在生成草稿', busy: true })
    expect(executing).toMatchObject({ phase: 'working', label: '正在运行代码', detail: '实际运行 main.py', targetPath: '/autonomy' })
    expect(executing?.key).not.toBe(drafting?.key)
    expect(executing?.key).not.toBe(derive({ autonomy: activity({ activityId: 'run-b', creation: { phase: 'executing', message: '实际运行 main.py' } }) })?.key)
    expect(derive({ autonomy: activity({ kind: 'office', creation: { phase: 'executing', message: '生成文档文件' } }) })).toMatchObject({ phase: 'working', label: '正在制作文档' })
  })

  it('claims verified artifacts only with actual artifact evidence and never claims export', () => {
    const ready = derive({ autonomy: activity({ creation: { phase: 'ready', message: '核验通过', artifact } }) })
    expect(ready).toMatchObject({ phase: 'ready', label: '产物已核验，待保存', busy: false })
    expect(ready?.key).toContain('artifact-1')
    expect(`${ready?.label} ${ready?.detail}`).not.toContain('已导出')
    const missing = derive({ autonomy: activity({ creation: { phase: 'ready', message: '缺少实际文件' } }) })
    expect(missing?.phase).toBe('waiting')
    expect(missing?.label).not.toMatch(/已核验|完成|成功/)
  })

  it('ignores ready residue after stopping and shows preparing, stopping and failure honestly', () => {
    const creation = { phase: 'ready' as const, message: '上次核验通过', artifact }
    expect(derive({ autonomy: activity({ running: false, phase: 'stopped', creation }) })).toBeNull()
    expect(derive({ autonomy: activity({ running: false, phase: 'idle', creation }) })).toBeNull()
    expect(derive({ autonomy: activity({ running: false, phase: 'preparing', busy: true }) })).toMatchObject({ phase: 'waiting', label: '正在准备隔离环境' })
    expect(derive({ autonomy: activity({ phase: 'stopping', creation }) })).toMatchObject({ phase: 'stopping', label: '正在结束活动' })
    expect(derive({ autonomy: activity({ running: false, phase: 'failed', reason: '运行超时', creation: { phase: 'failed', message: '脚本未通过' } }) })).toMatchObject({ phase: 'failed', busy: false })
  })

  it('shows an exact saved receipt without repeating the completion motion and ignores mismatched receipts', () => {
    const creation = { phase: 'ready' as const, message: '核验通过', artifact }
    const pending = derive({ autonomy: activity({ creation }) })
    const saved = { artifactId: artifact.id, path: 'E:/synthetic/result.py', bytes: artifact.bytes, sha256: artifact.sha256 }
    const work = derive({ autonomy: activity({ creation: { ...creation, saved } }) })
    expect(work).toMatchObject({ phase: 'ready', label: '产物已保存', detail: saved.path, key: pending?.key })
    for (const wrong of [{ ...saved, artifactId: 'old' }, { ...saved, sha256: 'changed' }, { ...saved, bytes: 0 }, { ...saved, path: '' }]) {
      expect(derive({ autonomy: activity({ creation: { ...creation, saved: wrong } }) })?.label).toBe('产物已核验，待保存')
    }
    expect(derive({ autonomy: activity({ phase: 'stopped', running: false, creation: { ...creation, saved } }) })).toBeNull()
  })

  it.each(['manual', 'browse', 'video'] as const)('preserves observed %s activity reason without claiming coding', kind => {
    const work = derive({ autonomy: activity({ kind, busy: false, reason: '已观察到页面标题：测试资料' }) })
    expect(work?.detail).toBe('已观察到页面标题：测试资料')
    expect(work?.label).not.toMatch(/代码|编程|文档|产物已核验/)
  })
})

const work = (phase: PetWorkState['phase']): PetWorkState => ({ key: `fixture:${phase}`, source: 'autonomy', phase, label: phase, detail: '', busy: !['ready', 'failed'].includes(phase), targetPath: '/autonomy' })
describe('宠物真实动作组', () => {
  it.each(['naiwa', 'tororo', 'whale-girl'])('acknowledges partial completion neutrally for %s without celebrating or calling it a failure', preset => {
    const partial = derive({ tasks: [task('partial', '部分完成', { result: '完成了部分文件，其他需要继续处理' })] })
    expect(partial).toMatchObject({ phase: 'ready', label: '做了一部分' })
    expect(petWorkMotion(partial, preset, false)).toMatchObject({ motion: preset === 'whale-girl' ? 'idle' : 'Idle', expression: null, loop: false })
  })

  it('uses the new native working loop and neutral thinking loops for naiwa', () => {
    expect(petWorkMotion(work('working'), 'naiwa', false)).toMatchObject({ motion: 'WorkingLoop', expression: null, loop: true })
    for (const phase of ['waiting', 'reviewing'] as const) expect(petWorkMotion(work(phase), 'naiwa', false)).toMatchObject({ motion: 'Think', expression: null, loop: true })
    expect(petWorkMotion(work('ready'), 'naiwa', false)).toMatchObject({ motion: 'Agree', expression: null, loop: false })
    expect(petWorkMotion(work('failed'), 'naiwa', false)).toMatchObject({ motion: 'Confused', expression: null, loop: false })
  })

  it('does not invent a typing motion for tororo and uses existing whale expressions', () => {
    for (const phase of ['waiting', 'working', 'reviewing'] as const) expect(petWorkMotion(work(phase), 'tororo', false)).toMatchObject({ motion: 'Idle', expression: null, loop: true })
    expect(petWorkMotion(work('ready'), 'tororo', false)).toMatchObject({ motion: 'FlickUp', loop: false })
    expect(petWorkMotion(work('failed'), 'tororo', false)).toMatchObject({ motion: 'FlickDown', loop: false })
    expect(petWorkMotion(work('waiting'), 'whale-girl', false)).toMatchObject({ motion: 'idle', expression: '问号', loop: true })
    expect(petWorkMotion(work('ready'), 'whale-girl', false)).toMatchObject({ motion: 'aidale', expression: '开心兴奋', loop: false })
    expect(petWorkMotion(work('failed'), 'whale-girl', false)).toMatchObject({ motion: 'idle', expression: '悲伤', loop: false })
  })

  it('does not override imported models or stopping and empty states', () => {
    expect(petWorkMotion(work('working'), 'naiwa', true)).toBeNull()
    expect(petWorkMotion(work('working'), 'custom-id', false)).toBeNull()
    expect(petWorkMotion(work('stopping'), 'naiwa', false)).toBeNull()
    expect(petWorkMotion(null, 'tororo', false)).toBeNull()
  })

  it.each([['tororo', 'tororo.model3.json'], ['whale-girl', 'c_0120.model3.json'], ['naiwa', '奶蛙.model3.json']])('references only real motion groups and expressions for %s', (preset, file) => {
    const model = JSON.parse(readFileSync(resolve('src/renderer/public/live2d', preset, file), 'utf8'))
    for (const phase of ['waiting', 'working', 'reviewing', 'ready', 'failed'] as const) {
      const motion = petWorkMotion(work(phase), preset, false)!
      expect(Object.keys(model.FileReferences.Motions)).toContain(motion.motion)
      if (motion.expression) expect(model.FileReferences.Expressions.map((item: { Name: string }) => item.Name)).toContain(motion.expression)
    }
  })
})
