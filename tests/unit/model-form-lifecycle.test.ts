// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ModelInput, ModelProfile, MurasameApi, Result } from '../../src/shared/types'
import { initialBootstrap } from '../../src/shared/mock-data'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'
import { ModelsPage } from '../../src/renderer/src/pages/ModelsPage'

const existing: ModelProfile = { id: 'existing', name: '原服务', provider: 'OpenAI Compatible', endpoint: 'http://127.0.0.1:9999/v1', key: '', hasKey: true, model: 'test-model', caps: [], capabilities: [], probeNote: '', status: '在线', tone: 'green', default: true, latency: '10 ms' }
const created: ModelProfile = { ...existing, id: 'created', name: '新的模型配置', endpoint: '', model: '', hasKey: false, default: false, status: '未验证' }

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(done => { resolve = done }), resolve: value => resolve(value) }
}

beforeEach(() => {
  resetStoreForTests()
  useAppStore.setState({ data: { ...initialBootstrap(), models: [] }, loading: false })
  let verified = existing
  Object.defineProperty(window, 'murasame', { configurable: true, value: { core: {
    createModel: vi.fn(async () => ({ ok: true, data: created })),
    verifyModel: vi.fn(async (id: string, input?: ModelInput) => {
      verified = { ...existing, ...input, id, hasKey: true, status: '在线' }
      return { ok: true, data: verified }
    }),
    setDefaultModel: vi.fn(async () => ({ ok: true, data: [{ ...verified, default: true }] })),
    deleteModel: vi.fn(async () => ({ ok: true, data: [] }))
  } } as unknown as MurasameApi })
})

afterEach(() => { cleanup(); resetStoreForTests(); vi.restoreAllMocks() })

async function mount(): Promise<void> {
  await act(async () => { render(createElement(MemoryRouter, null, createElement(ModelsPage))) })
}

it('does not offer editable fields until adding and initializing the new draft both finish', async () => {
  const pending = deferred<Result<ModelProfile>>()
  vi.mocked(window.murasame.core.createModel).mockReturnValue(pending.promise)
  await mount()
  await act(async () => { fireEvent.click(screen.getByTestId('add-model')) })
  for (const id of ['model-config-name', 'model-endpoint', 'model-name', 'model-key', 'model-provider', 'model-preset-ollama']) {
    expect(screen.getByTestId(id).matches(':disabled'), `${id} must not accept input while its draft may be replaced`).toBe(true)
  }
  await act(async () => { pending.resolve({ ok: true, data: created }) })
  const name = screen.getByTestId('model-config-name') as HTMLInputElement
  expect(name.matches(':disabled')).toBe(false)
  expect(name.value).toBe('新的模型配置')
  fireEvent.change(name, { target: { value: '端到端测试服务' } })
  fireEvent.change(screen.getByTestId('model-endpoint'), { target: { value: 'http://127.0.0.1:9999/v1' } })
  fireEvent.change(screen.getByTestId('model-name'), { target: { value: 'test-model' } })
  fireEvent.change(screen.getByTestId('model-key'), { target: { value: 'test-key' } })
  await act(async () => { fireEvent.click(screen.getByTestId('verify-model')) })
  expect(name.value).toBe('端到端测试服务')
  expect(screen.getByTestId('current-service-name').textContent).toBe('端到端测试服务')
})

it('unlocks the previous draft intact when adding a new configuration fails', async () => {
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing] }, selectedModelId: existing.id })
  const pending = deferred<Result<ModelProfile>>()
  vi.mocked(window.murasame.core.createModel).mockReturnValue(pending.promise)
  await mount()
  const name = screen.getByTestId('model-config-name') as HTMLInputElement
  fireEvent.change(name, { target: { value: '尚未保存的名称' } })
  await act(async () => { fireEvent.click(screen.getByTestId('add-model')) })
  expect(name.matches(':disabled')).toBe(true)
  expect(screen.getByTestId('model-item').matches(':disabled')).toBe(true)
  expect(screen.getByTestId('delete-model').matches(':disabled')).toBe(true)
  await act(async () => { pending.resolve({ ok: false, error: '独立测试：新增配置未保存' }) })
  expect(name.matches(':disabled')).toBe(false)
  expect(name.value).toBe('尚未保存的名称')
  expect(useAppStore.getState().selectedModelId).toBe(existing.id)
})

it('keeps the draft locked throughout verification and activation before exposing its final values', async () => {
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing] }, selectedModelId: existing.id })
  const verification = deferred<Result<ModelProfile>>()
  const activation = deferred<Result<ModelProfile[]>>()
  vi.mocked(window.murasame.core.verifyModel).mockReturnValue(verification.promise)
  vi.mocked(window.murasame.core.setDefaultModel).mockReturnValue(activation.promise)
  await mount()
  const name = screen.getByTestId('model-config-name') as HTMLInputElement
  fireEvent.change(name, { target: { value: '更新后的服务名称' } })
  await act(async () => { fireEvent.click(screen.getByTestId('verify-model')) })
  expect(name.matches(':disabled')).toBe(true)
  expect(screen.getByTestId('model-item').matches(':disabled')).toBe(true)
  const verified = { ...existing, name: '更新后的服务名称' }
  await act(async () => { verification.resolve({ ok: true, data: verified }) })
  expect(name.matches(':disabled')).toBe(true)
  await act(async () => { activation.resolve({ ok: true, data: [verified] }) })
  expect(name.matches(':disabled')).toBe(false)
  expect(name.value).toBe('更新后的服务名称')
  expect(screen.getByTestId('current-service-name').textContent).toBe('更新后的服务名称')
})

it('releases the form and shows a transport failure without losing the draft', async () => {
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing] }, selectedModelId: existing.id })
  vi.mocked(window.murasame.core.createModel).mockRejectedValue(new Error('独立测试：新增请求连接中断'))
  await mount()
  const name = screen.getByTestId('model-config-name') as HTMLInputElement
  fireEvent.change(name, { target: { value: '中断前的草稿名称' } })
  await act(async () => { fireEvent.click(screen.getByTestId('add-model')) })
  expect(name.matches(':disabled')).toBe(false)
  expect(name.value).toBe('中断前的草稿名称')
  expect(document.querySelector('.use-result')?.textContent).toContain('新增请求连接中断')
})

it('prevents selecting or editing another model until deletion has initialized the remaining draft', async () => {
  const other = { ...existing, id: 'other', name: '保留的服务', default: false }
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing, other] }, selectedModelId: existing.id })
  const pending = deferred<Result<ModelProfile[]>>()
  vi.mocked(window.murasame.core.deleteModel).mockReturnValue(pending.promise)
  await mount()
  await act(async () => { fireEvent.click(screen.getByTestId('delete-model')) })
  expect(screen.getByTestId('model-config-name').matches(':disabled')).toBe(true)
  expect(screen.getAllByTestId('model-item').every(button => button.matches(':disabled'))).toBe(true)
  await act(async () => { pending.resolve({ ok: true, data: [other] }) })
  const name = screen.getByTestId('model-config-name') as HTMLInputElement
  expect(name.matches(':disabled')).toBe(false)
  expect(name.value).toBe('保留的服务')
  expect(useAppStore.getState().selectedModelId).toBe(other.id)
})

it('rechecks the saved current service without discarding an already edited draft', async () => {
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing] }, selectedModelId: existing.id })
  const pending = deferred<Result<ModelProfile>>()
  vi.mocked(window.murasame.core.verifyModel).mockReturnValue(pending.promise)
  await mount()
  const name = screen.getByTestId('model-config-name') as HTMLInputElement
  fireEvent.change(name, { target: { value: '还没验证的新草稿名称' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再测一次' })) })
  const wasLocked = name.matches(':disabled')
  await act(async () => { pending.resolve({ ok: true, data: { ...existing, latency: '20 ms' } }) })
  expect(name.value).toBe('还没验证的新草稿名称')
  expect(wasLocked).toBe(true)
  expect(name.matches(':disabled')).toBe(false)
  expect(screen.getByTestId('current-service-name').textContent).toBe('原服务')
})

it.each(['verify', 'delete', 'activate', 'recheck'] as const)('releases the %s transaction after an exception so the user can retry', async (action) => {
  const model = { ...existing, default: action !== 'activate' }
  useAppStore.setState({ data: { ...initialBootstrap(), models: [model] }, selectedModelId: model.id })
  const error = new Error(`独立测试：${action}请求中断`)
  if (action === 'delete') vi.mocked(window.murasame.core.deleteModel).mockRejectedValue(error)
  else if (action === 'activate') vi.mocked(window.murasame.core.setDefaultModel).mockRejectedValue(error)
  else vi.mocked(window.murasame.core.verifyModel).mockRejectedValue(error)
  await mount()
  const name = screen.getByTestId('model-config-name') as HTMLInputElement
  const expectedName = action === 'activate' ? '原服务' : '请求前保留的草稿'
  if (action !== 'activate') fireEvent.change(name, { target: { value: expectedName } })
  const button = action === 'recheck'
    ? screen.getByRole('button', { name: '再测一次' })
    : screen.getByTestId(action === 'activate' ? 'set-default-model' : `${action}-model`)
  await act(async () => { fireEvent.click(button) })
  expect(name.matches(':disabled')).toBe(false)
  expect(name.value).toBe(expectedName)
  expect(document.querySelector('.use-result')?.textContent).toContain(error.message)
  await act(async () => { fireEvent.click(screen.getByTestId('add-model')) })
  expect(window.murasame.core.createModel).toHaveBeenCalledOnce()
  expect(name.value).toBe('新的模型配置')
})

it.each([false, true])('says a failed current-service recheck retains its configuration even when another model is selected: %s', async (selectOther) => {
  const other = { ...existing, id: 'other', name: '备用配置', default: false }
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing, other] }, selectedModelId: selectOther ? other.id : existing.id })
  vi.mocked(window.murasame.core.verifyModel).mockResolvedValue({ ok: false, error: '本次请求超时' })
  await mount()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再测一次' })) })
  expect(document.querySelector('.use-result strong')?.textContent).toContain('本次验证未通过，当前配置已保留')
  expect(document.querySelector('.use-result')?.textContent).toContain('「原服务」仍是当前服务配置')
  expect(document.querySelector('.use-result')?.textContent).toContain('本次请求超时')
  expect(document.querySelector('.current-service-banner')?.textContent).toContain('连接状态待确认')
  expect(document.querySelector('.current-service-banner')?.textContent).not.toContain('验证成功')
  const currentItem = screen.getAllByTestId('model-item').find(item => item.textContent?.includes('原服务'))
  expect(currentItem?.textContent).toContain('本次未通过')
  expect(currentItem?.textContent).not.toContain('验证成功')
  expect(useAppStore.getState().data?.models.find(model => model.default)).toEqual(existing)
})

it('retains current-service wording after a completed recheck reports the saved profile offline', async () => {
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing] }, selectedModelId: existing.id })
  vi.mocked(window.murasame.core.verifyModel).mockResolvedValue({ ok: true, data: { ...existing, status: '离线', tone: 'red' } })
  await mount()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再测一次' })) })
  expect(document.querySelector('.use-result strong')?.textContent).toContain('本次验证未通过，当前配置已保留')
  expect(document.querySelector('.current-service-banner')?.textContent).toContain('连接状态待确认')
  expect(useAppStore.getState().data?.models.find(model => model.default)?.id).toBe(existing.id)
})

it.each([false, true])('describes an unactivated configuration without claiming another current service was disabled: %s', async (hasCurrent) => {
  const other = { ...existing, id: 'other', name: '备用配置', default: false }
  useAppStore.setState({ data: { ...initialBootstrap(), models: hasCurrent ? [existing, other] : [other] }, selectedModelId: other.id })
  vi.mocked(window.murasame.core.verifyModel).mockResolvedValue({ ok: false, error: '本次请求超时' })
  await mount()
  await act(async () => { fireEvent.click(screen.getByTestId('verify-model')) })
  expect(document.querySelector('.use-result strong')?.textContent).toContain(hasCurrent
    ? '这条配置未启用，当前服务配置未变'
    : '验证未通过，这条配置还未启用')
  expect(document.querySelector('.use-result')?.textContent).toContain(hasCurrent
    ? '仍保留「原服务」的配置'
    : '验证通过后才能设为当前使用')
  expect(document.querySelector('.use-result')?.textContent).toContain('本次请求超时')
  expect(screen.getAllByTestId('model-item').find(item => item.textContent?.includes('备用配置'))?.textContent).toContain('本次未通过')
  expect(useAppStore.getState().data?.models.find(model => model.default)?.id).toBe(hasCurrent ? existing.id : undefined)
})

it('does not describe a creation failure as a failed connection check', async () => {
  useAppStore.setState({ data: { ...initialBootstrap(), models: [existing] }, selectedModelId: existing.id })
  vi.mocked(window.murasame.core.createModel).mockRejectedValue(new Error('新增配置失败'))
  await mount()
  await act(async () => { fireEvent.click(screen.getByTestId('add-model')) })
  expect(document.querySelector('.use-result strong')?.textContent).toContain('本次操作未完成')
  expect(document.querySelector('.use-result')?.textContent).not.toContain('验证未通过')
})
