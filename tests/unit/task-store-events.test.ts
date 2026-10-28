// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { MurasameApi, Task } from '../../src/shared/types'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

afterEach(() => { resetStoreForTests(); vi.clearAllTimers(); vi.useRealTimers() })
it('shows one task when the creation event arrives before the IPC reply', async () => {
  vi.useFakeTimers(); resetStoreForTests()
  const task: Task = { id: 'same-task', title: '整理文件', status: '等待批准', tone: 'amber', progress: 0, created: '', model: '', modelProfileId: null, scope: '', summary: '', steps: [], artifacts: [], approval: null, result: '', toolCalls: [], verdict: null }
  useAppStore.setState({ data: { ...initialBootstrap(), tasks: [] } })
  window.murasame = { core: { createTask: async () => {
    // The main process emits the created task before resolving its create call.
    const data = useAppStore.getState().data!
    useAppStore.setState({ data: { ...data, tasks: [task, ...data.tasks] } })
    return { ok: true, data: task }
  } } } as unknown as MurasameApi
  await useAppStore.getState().createTask('整理文件')
  expect(useAppStore.getState().data?.tasks.map(item => item.id)).toEqual(['same-task'])
})

it('[FR-16] 将所选目录作为独立字段传递，保留用户原始任务标题', async () => {
  vi.useFakeTimers(); resetStoreForTests()
  const createTask = vi.fn(async () => ({ ok: false, error: 'fixture boundary' }))
  window.murasame = { core: { createTask } } as unknown as MurasameApi
  await useAppStore.getState().createTask('整理资料', 'E:\\独立测试目录')
  expect(createTask).toHaveBeenCalledWith('整理资料', 'E:\\独立测试目录')
})
