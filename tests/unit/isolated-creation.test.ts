import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { creationDraftSchema, verifyCreationEvidence } from '../../src/main/isolation/creation'
import { AutonomyService } from '../../src/main/core/services/autonomy-service'
import type { CreationAgents } from '../../src/main/isolation/creation'
import { ModelService } from '../../src/main/core/services/model-service'
import { ModelGateway } from '../../src/main/model/gateway'
import type { ModelRegistry, ResolvedModel } from '../../src/main/model/registry'
import type { DockerRunner } from '../../src/main/isolation/docker-runtime'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const bytes = Buffer.from('print(42)')
const evidence = () => ({ name: 'main.py' as const, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64'), text: 'print(42)', stdout: '42\n', stderr: '', exitCode: 0, timedOut: false })
const draft = { title: '独立代码', content: 'print(42)', expectedOutput: '42' }
it('[FR-28] 接受真实代码文件、独立hash与实际运行输出', () => {
  expect(verifyCreationEvidence('code', draft, evidence()).sha256).toBe(evidence().sha256)
})
it('[FR-21] 声明成功不能覆盖真实失败、超时或错误输出', () => {
  for (const patch of [{ exitCode: 1 }, { timedOut: true }, { stdout: '43' }, { text: 'different' }, { sha256: 'a'.repeat(64) }, { name: '../../host.py' }, { bytes: 999 }]) {
    expect(() => verifyCreationEvidence('code', draft, { ...evidence(), ...patch })).toThrow()
  }
})
it('[FR-28] 办公文档必须是实际ODT且回读文字与候选一致', () => {
  expect(() => verifyCreationEvidence('office', { title: '独立文档', content: '正文', expectedOutput: '' }, { ...evidence(), name: 'document.odt', text: '正文' })).toThrow()
})
it('[NFR-R01] 拒绝空候选、无限正文和额外工具字段', () => {
  expect(creationDraftSchema.safeParse(draft).success).toBe(true)
  for (const patch of [{ content: '' }, { content: 'x'.repeat(24001) }, { command: 'host-command' }]) expect(creationDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(false)
})

function serviceFixture(override?: DockerRunner) {
  const calls: string[][] = []
  const service = new AutonomyService((_command, args, options) => {
    calls.push(args)
    if (args[0] === 'image') return '3'
    if (args[0] === 'run') return 'fixture-container'
    if (args[0] === 'inspect') return 'true'
    if (args.includes('/opt/murasame/creation-runner.py')) return override ? override(_command, args, options) : JSON.stringify(evidence())
    return ''
  }, async () => {})
  const agents: CreationAgents = { modelName: 'bound-fixture', draft: async (_input, control) => { control.beforeSend(); return draft }, review: async (_input, control) => { control.beforeSend(); return { accepted: true, reason: '实际输出42与目标一致' } } }
  return { service, agents, calls }
}
const startInput = { dockerAvailable: true, approved: true, needsPermission: false, share: null, allowNetwork: false }
it('[FR-28] 创作真实核验后保留桌面及产物，明确结束才清理', async () => {
  const { service, agents, calls } = serviceFixture()
  await service.start(startInput)
  const result = await service.produce('code', '打印42', agents)
  expect(result.ok).toBe(true)
  expect(service.status().creation?.phase).toBe('ready')
  expect(service.status().running).toBe(true)
  expect(calls.some(args => args.includes('xdotool'))).toBe(false)
  await service.stop({ containerGone: false })
  expect(service.status().result?.status).toBe('completed')
  expect(calls.some(args => args[0] === 'rm')).toBe(true)
})

it('[FR-29] 独立审阅最多触发一次修订，不接受持续拒绝的产物', async () => {
  const { service, agents, calls } = serviceFixture()
  const feedback: unknown[] = []
  agents.draft = async (input, control) => { control.beforeSend(); feedback.push(input.feedback); return draft }
  agents.review = async (_input, control) => { control.beforeSend(); return { accepted: false, reason: '不满足完整目标' } }
  await service.start(startInput)
  expect((await service.produce('code', '打印42', agents)).ok).toBe(false)
  expect(feedback).toHaveLength(2); expect(feedback[1]).toContain('不满足完整目标')
  expect(calls.filter(args => args.includes('/opt/murasame/creation-runner.py'))).toHaveLength(2)
  expect(service.status().result?.status).toBe('failed')
})

it('[NFR-R01] 实际发送预算包含角色内部的结构重试', async () => {
  const { service, agents, calls } = serviceFixture(); let allowed = 0
  agents.draft = async (_input, control) => { for (let index = 0; index < 7; index++) { control.beforeSend(); allowed++ } return draft }
  await service.start(startInput)
  expect((await service.produce('code', '打印42', agents)).ok).toBe(false)
  expect(allowed).toBe(6)
  expect(calls.some(args => args.includes('/opt/murasame/creation-runner.py'))).toBe(false)
  expect(service.status().result?.status).toBe('limited')
})

it('[FR-30] 导出回读期间撤回许可不会留下宿主文件', async () => {
  let allowed = true
  const { service, agents } = serviceFixture(async (_command, _args, options) => {
    if (JSON.parse(options?.input ?? '{}').action === 'read') allowed = false
    return JSON.stringify(evidence())
  })
  service.configure({ guard: () => allowed })
  await service.start(startInput); await service.produce('code', '打印42', agents)
  const output = join(mkdtempSync(join(tmpdir(), 'murasame-export-')), 'output.py')
  const result = await service.exportCreation(service.status().creation!.artifact!.id, output)
  expect(result.ok).toBe(false); expect(existsSync(output)).toBe(false)
  await service.stop({ containerGone: false })
})

it('[FR-28] 导出核对内容、不覆盖旧文件，过期产物及类型切换不能复用成功', async () => {
  let changed = false
  const { service, agents } = serviceFixture(async () => JSON.stringify({ ...evidence(), ...(changed ? { base64: Buffer.from('changed').toString('base64') } : {}) }))
  await service.start(startInput); await service.produce('code', '打印42', agents)
  const id = service.status().creation!.artifact!.id
  const output = join(mkdtempSync(join(tmpdir(), 'murasame-export-')), 'output.py')
  expect((await service.exportCreation(id, output)).ok).toBe(true)
  expect((await service.exportCreation(id, output)).ok).toBe(false)
  expect(readFileSync(output, 'utf8')).toBe(draft.content)
  changed = true
  const next = join(output, '..', 'next.py')
  expect((await service.exportCreation(id, next)).ok).toBe(false); expect(existsSync(next)).toBe(false)
  expect((await service.openPage('https://example.com')).ok).toBe(false)
  expect(service.status().creation?.artifact?.id).toBe(id)
  await service.stop({ containerGone: false })
  expect((await service.exportCreation(id, next)).ok).toBe(false)
})

it('[FR-29] 创作与独立审阅绑定已验证模型，不随默认模型切换', async () => {
  const model = { id: 'a', name: 'A', apiKey: 'synthetic-secret', capabilities: ['text.chat', 'tools.function-calling'].map(id => ({ id, status: 'verified' })) } as ResolvedModel
  let current = model
  const registry = { getDefault: () => current } as unknown as ModelRegistry
  const seen: Array<{ id: string; tool: string; prompt: string }> = []
  vi.spyOn(ModelGateway.prototype, 'callStructured').mockImplementation(async (selected, _schema, tool, _description, _messages, system) => {
    seen.push({ id: selected.id, tool, prompt: system ?? '' })
    return (tool === 'create_isolated_artifact' ? draft : { accepted: true, reason: '独立审阅' }) as never
  })
  const modelService = new ModelService(registry)
  const bound = modelService.bindCreationAgents()
  current = { ...model, id: 'b', name: 'B' }; model.id = 'mutated'
  const control = { signal: new AbortController().signal, beforeSend() {} }
  await bound.draft({ kind: 'code', goal: '打印42' }, control)
  await bound.review({ kind: 'code', goal: '打印42', draft, evidence: evidence() }, control)
  expect(seen.map(item => item.id)).toEqual(['a', 'a'])
  expect(seen.map(item => item.tool)).toEqual(['create_isolated_artifact', 'review_isolated_artifact'])
  expect(seen[1].prompt).toContain('独立Critic')
  current = { ...current, capabilities: [] }
  expect(() => modelService.bindCreationAgents()).toThrow('已验证')
})

it.each(['budget', 'revoked'] as const)('[FR-30] %s终态跨模型错误包装仍保留', async mode => {
  const { service, agents } = serviceFixture(); let allowed = true
  service.configure({ creationAllowed: () => allowed })
  agents.draft = async (_input, control) => {
    try {
      if (mode === 'revoked') { control.beforeSend(); allowed = false }
      for (let index = 0; index < 7; index++) control.beforeSend()
    } catch (error) { throw new Error('提供方包装后的通用错误', { cause: error }) }
    return draft
  }
  await service.start(startInput)
  expect((await service.produce('code', '打印42', agents)).ok).toBe(false)
  expect(service.status().result?.status).toBe(mode === 'budget' ? 'limited' : 'cancelled')
  expect(service.status().busy).toBe(false)
})

it('[NFR-R01] 模型尚在排队时180秒期限也立即结束，迟到候选不执行', async () => {
  vi.useFakeTimers()
  const { service, agents, calls } = serviceFixture()
  let release!: (value: typeof draft) => void
  let entered!: () => void
  const queued = new Promise<void>(done => { entered = done })
  agents.draft = async () => { entered(); return new Promise(resolve => { release = resolve }) }
  await service.start(startInput)
  const pending = service.produce('code', '打印42', agents)
  await queued; await vi.advanceTimersByTimeAsync(180001)
  expect((await pending).ok).toBe(false)
  expect(service.status().result?.status).toBe('limited')
  expect(service.status().busy).toBe(false)
  release(draft); await Promise.resolve()
  expect(calls.some(args => args.includes('/opt/murasame/creation-runner.py'))).toBe(false)
})
it('[FR-30] 取消时迟到Worker结果不得创建产物或追加成功', async () => {
  const { service, agents, calls } = serviceFixture()
  let release!: (value: typeof draft) => void
  let entered!: () => void
  const ready = new Promise<void>(done => { entered = done })
  agents.draft = async () => { entered(); return new Promise(resolve => { release = resolve }) }
  await service.start(startInput)
  const pending = service.produce('code', '打印42', agents)
  await ready; await service.stop({ containerGone: false }); release(draft)
  expect((await pending).ok).toBe(false)
  expect(calls.some(args => args.includes('/opt/murasame/creation-runner.py'))).toBe(false)
  expect(service.status().result?.status).toBe('cancelled')
})
