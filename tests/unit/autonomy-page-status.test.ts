// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityStatus, MurasameApi, Result } from '../../src/shared/types'
import { AutonomyPage } from '../../src/renderer/src/pages/AutonomyPage'

const idle: ActivityStatus = { running: false, phase: 'idle', reason: '独立测试：尚未开始', viewUrl: '', notes: [], taskStatus: '', canStop: false, busy: false }
const active: ActivityStatus = { ...idle, activityId: 'activity-a', kind: 'code', running: true, phase: 'running', reason: '独立测试：真实运行态', canStop: true, allowNetwork: false }
const stopped: ActivityStatus = { ...active, running: false, phase: 'stopped', canStop: false, reason: '独立测试：已停止' }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) } }
let current: ActivityStatus
let listeners: Set<(state: ActivityStatus) => void>
let api: MurasameApi['autonomy']
const mount = async () => { let view!: ReturnType<typeof render>; await act(async () => { view = render(createElement(AutonomyPage)) }); return view }
const emit = async (value: ActivityStatus) => { await act(async () => { current = value; for (const listener of listeners) listener(value) }) }
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.useFakeTimers()
  current = { ...idle }; listeners = new Set()
  api = {
    status: vi.fn(async () => current),
    environment: vi.fn(async () => ({ docker: true, image: true, detail: '独立测试环境就绪' })),
    onStatusChanged: (listener: (state: ActivityStatus) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    onBuildProgress: () => () => {},
    preview: vi.fn(async () => ({ ok: true, data: { image: 'independent-frame' } })),
    start: vi.fn(async () => ({ ok: true, data: active })),
    stop: vi.fn(async () => { current = stopped; for (const listener of listeners) listener(stopped); return { ok: true, data: stopped } }),
    create: vi.fn(), look: vi.fn(), openPage: vi.fn(), browse: vi.fn(), watch: vi.fn(), buildImage: vi.fn(), exportArtifact: vi.fn()
  } as unknown as MurasameApi['autonomy']
  Object.defineProperty(window, 'murasame', { configurable: true, value: { autonomy: api } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('autonomy page follows service state', () => {
  it('updates an already open idle page when another entry starts, progresses and stops', async () => {
    await mount()
    expect(screen.getByTestId('autonomy-stop')).toBeDisabled()
    await emit({ ...active, busy: true, creation: { phase: 'reviewing', message: '独立审阅正在检查产物' } })
    expect(screen.getByTestId('autonomy-stop')).toBeEnabled()
    expect(screen.getByRole('combobox')).toHaveValue('写代码')
    expect(screen.getByRole('status')).toHaveTextContent('独立审阅正在检查产物')
    expect(screen.getByAltText('离线隔离桌面实时画面')).toBeVisible()
    await emit(stopped)
    expect(screen.getByTestId('autonomy-stop')).toBeDisabled()
    expect(screen.queryByAltText('离线隔离桌面实时画面')).not.toBeInTheDocument()
    expect(screen.getByText(stopped.reason)).toBeVisible()
  })

  it('does not restore a running snapshot older than a stop event', async () => {
    const pending = deferred<ActivityStatus>()
    vi.mocked(api.status).mockReturnValueOnce(pending.promise)
    await mount()
    await emit(stopped)
    await act(async () => { pending.resolve(active) })
    expect(screen.getByText(stopped.reason)).toBeVisible()
    expect(screen.getByTestId('autonomy-stop')).toBeDisabled()
  })

  it('keeps user draft choices when the same stopped activity is polled repeatedly', async () => {
    current = { ...stopped, goal: '旧创作目标' }
    await mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '办公' } })
    fireEvent.change(screen.getByRole('textbox', { name: /创作目标/ }), { target: { value: '用户正在填写的新目标' } })
    fireEvent.click(screen.getByRole('switch', { name: '允许隔离桌面联网' }))
    await advance(15_000)
    expect(screen.getByRole('combobox')).toHaveValue('办公')
    expect(screen.getByRole('textbox', { name: /创作目标/ })).toHaveValue('用户正在填写的新目标')
    expect(screen.getByRole('switch', { name: '允许隔离桌面联网' })).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps edits made before a late initial stopped snapshot arrives', async () => {
    const pending = deferred<ActivityStatus>()
    vi.mocked(api.status).mockReturnValueOnce(pending.promise)
    await mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '办公' } })
    fireEvent.change(screen.getByRole('textbox', { name: /创作目标/ }), { target: { value: '刚输入的新目标' } })
    await act(async () => { pending.resolve({ ...stopped, goal: '旧目标' }) })
    expect(screen.getByRole('combobox')).toHaveValue('办公')
    expect(screen.getByRole('textbox', { name: /创作目标/ })).toHaveValue('刚输入的新目标')
  })

  it('serializes health reads even while a response is slow, then unsubscribes on unmount', async () => {
    current = active
    const view = await mount()
    const pending = deferred<ActivityStatus>()
    let concurrent = 0, peak = 0
    vi.mocked(api.status).mockImplementation(() => {
      concurrent++; peak = Math.max(peak, concurrent)
      return pending.promise.finally(() => { concurrent-- })
    })
    await advance(20_000)
    expect(peak).toBe(1)
    view.unmount()
    await act(async () => { pending.resolve(active) })
    await advance(20_000)
    expect(concurrent).toBe(0)
    expect(listeners.size).toBe(0)
    expect(peak).toBe(1)
  })

  it('does not replace a new goal with the previous server goal during an active health refresh', async () => {
    current = { ...active, goal: '上一次目标' }
    await mount()
    fireEvent.change(screen.getByRole('textbox', { name: /创作目标/ }), { target: { value: '尚未提交的新目标' } })
    await advance(6000)
    expect(screen.getByRole('textbox', { name: /创作目标/ })).toHaveValue('尚未提交的新目标')
  })

  it('does not resurrect work when a start response arrives after the user stopped it', async () => {
    const pending = deferred<Result<ActivityStatus>>()
    vi.mocked(api.start).mockReturnValue(pending.promise)
    await mount()
    fireEvent.click(screen.getByRole('switch', { name: '我确认只在隔离桌面里活动' }))
    fireEvent.click(screen.getByTestId('autonomy-start'))
    await emit({ ...idle, phase: 'preparing', busy: true, canStop: true, reason: '正在准备' })
    await act(async () => { fireEvent.click(screen.getByTestId('autonomy-stop')) })
    expect(screen.getByText(stopped.reason)).toBeVisible()
    await act(async () => { pending.resolve({ ok: true, data: active }) })
    expect(screen.getByText(stopped.reason)).toBeVisible()
    expect(screen.getByTestId('autonomy-stop')).toBeDisabled()
  })

  it('clears pending local work on an external stop and ignores its later failure', async () => {
    const pending = deferred<Result<ActivityStatus>>()
    vi.mocked(api.start).mockReturnValue(pending.promise)
    await mount()
    fireEvent.click(screen.getByRole('switch', { name: '我确认只在隔离桌面里活动' }))
    fireEvent.click(screen.getByTestId('autonomy-start'))
    await emit({ ...idle, phase: 'preparing', busy: true, canStop: true, reason: '正在准备' })
    await emit({ ...idle, phase: 'stopping', busy: true, canStop: true, reason: '外部入口正在停止准备' })
    await emit(stopped)
    expect(screen.getByText(stopped.reason)).toBeVisible()
    expect(screen.getByTestId('autonomy-stop')).toBeDisabled()
    await act(async () => { pending.resolve({ ok: false, error: '旧启动请求迟到的错误' }) })
    expect(screen.queryByText('旧启动请求迟到的错误')).not.toBeInTheDocument()
    expect(screen.getByText(stopped.reason)).toBeVisible()
  })

  it('shows a preparation failure after IPC publishes its intermediate idle status', async () => {
    const pending = deferred<Result<ActivityStatus>>()
    vi.mocked(api.start).mockReturnValue(pending.promise)
    await mount()
    fireEvent.click(screen.getByRole('switch', { name: '我确认只在隔离桌面里活动' }))
    fireEvent.click(screen.getByTestId('autonomy-start'))
    await emit({ ...idle, phase: 'preparing', busy: true, canStop: true, reason: '正在准备' })
    await emit(idle)
    await act(async () => { pending.resolve({ ok: false, error: '独立测试：Docker环境没有准备成功' }) })
    expect(screen.getByText('独立测试：Docker环境没有准备成功')).toBeVisible()
  })

  it('keeps a prefilled creation goal when starting an activity whose server goal is still empty', async () => {
    current = { ...idle, activityId: '', goal: '' }
    const pending = deferred<Result<ActivityStatus>>()
    vi.mocked(api.start).mockReturnValue(pending.promise)
    await mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '写代码' } })
    fireEvent.change(screen.getByRole('textbox', { name: /创作目标/ }), { target: { value: '用户预先输入的目标' } })
    fireEvent.click(screen.getByRole('switch', { name: '我确认只在隔离桌面里活动' }))
    fireEvent.click(screen.getByTestId('autonomy-start'))
    await emit({ ...idle, activityId: '', goal: '', phase: 'preparing', busy: true, canStop: true })
    await emit({ ...active, goal: '' })
    await act(async () => { pending.resolve({ ok: true, data: { ...active, goal: '' } }) })
    expect(screen.getByRole('textbox', { name: /创作目标/ })).toHaveValue('用户预先输入的目标')
  })

  it('preserves the last known activity on a health failure and recovers without an unhandled rejection', async () => {
    current = active
    await mount()
    vi.mocked(api.status).mockRejectedValueOnce(new Error('independent transport outage'))
    await advance(6000)
    expect(screen.getByTestId('autonomy-stop')).toBeEnabled()
    await emit(stopped)
    expect(screen.getByTestId('autonomy-stop')).toBeDisabled()
  })

  it('locks new starts and scope changes during externally observed container preparation', async () => {
    await mount()
    fireEvent.click(screen.getByRole('switch', { name: '我确认只在隔离桌面里活动' }))
    await emit({ ...active, phase: 'preparing', running: false, canStop: true, busy: false, reason: '容器正在启动' })
    expect(screen.getByTestId('autonomy-start')).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('switch', { name: '允许隔离桌面联网' })).toBeDisabled()
    expect(screen.getByTestId('autonomy-stop')).toBeEnabled()
  })

  it('keeps start and scope controls locked while a real stop is pending', async () => {
    current = active
    const pending = deferred<Result<ActivityStatus>>()
    vi.mocked(api.stop).mockReturnValue(pending.promise)
    await mount()
    fireEvent.click(screen.getByTestId('autonomy-stop'))
    await emit({ ...active, phase: 'stopping', running: false, canStop: true, busy: false, reason: '正在确认容器退出' })
    expect(screen.getByTestId('autonomy-start')).toBeDisabled()
    expect(screen.getByRole('switch', { name: '允许隔离桌面联网' })).toBeDisabled()
    expect(screen.getByTestId('autonomy-stop')).toBeDisabled()
    await emit({ ...stopped, phase: 'failed', canStop: true, reason: '仍有隔离容器未清理' })
    await act(async () => { pending.resolve({ ok: false, error: '仍有隔离容器未清理' }) })
    expect(screen.getByTestId('autonomy-start')).toBeDisabled()
    expect(screen.getByTestId('autonomy-stop')).toBeEnabled()
  })

  it('shows a failed stop result while health status remains unavailable', async () => {
    vi.mocked(api.status).mockRejectedValue(new Error('independent outage'))
    vi.mocked(api.stop).mockResolvedValue({ ok: false, error: '未确认容器退出，请重试停止' })
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('autonomy-stop')) })
    expect(screen.getByText('未确认容器退出，请重试停止')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法读取活动状态')
    expect(screen.getByTestId('autonomy-stop')).toBeEnabled()
  })
})
