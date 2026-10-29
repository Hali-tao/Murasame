// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BootstrapData, ModelProfile, MurasameApi, Result } from '../../src/shared/types'
import { initialBootstrap } from '../../src/shared/mock-data'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'
import { TopBar } from '../../src/renderer/src/components/TopBar'

const model: ModelProfile = { id: 'a', name: '原服务', provider: 'OpenAI Compatible', endpoint: 'http://127.0.0.1:9999/v1', key: '', hasKey: true, model: 'test-model', caps: [], capabilities: [], probeNote: '', status: '在线', tone: 'green', default: true, latency: '10 ms' }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) } }
let listener: ((models: ModelProfile[]) => void) | undefined
let api: MurasameApi
beforeEach(() => {
  resetStoreForTests(); listener = undefined
  const data = { ...initialBootstrap(), models: [model] }
  const noop = () => () => undefined
  api = {
    app: { getInfo: async () => ({ version: 'test', platform: 'win32' }) },
    settings: { get: async () => data.settings, onChanged: noop },
    core: { getBootstrap: async () => ({ ok: true, data }) },
    pet: { getState: async () => ({ visible: true }), onStateChanged: noop },
    events: { onModelsUpdated: (next: typeof listener) => { listener = next; return () => { listener = undefined } },
      onConversationUpdated: noop, onMessageStarted: noop, onMessageFailed: noop, onTaskUpdated: noop, onActiveConversation: noop }
  } as unknown as MurasameApi
  Object.defineProperty(window, 'murasame', { value: api, configurable: true })
})
afterEach(() => { cleanup(); resetStoreForTests(); vi.restoreAllMocks() })

it('keeps a model update received while the initial snapshot is delayed', async () => {
  const pending = deferred<Result<BootstrapData>>()
  api.core.getBootstrap = () => pending.promise
  const loading = useAppStore.getState().init()
  listener?.([{ ...model, status: '离线', tone: 'red' }])
  pending.resolve({ ok: true, data: { ...initialBootstrap(), models: [model] } })
  await loading
  expect(useAppStore.getState().data?.models[0].status).toBe('离线')
})

it.each(['verify', 'save', 'create', 'delete', 'default'] as const)('does not overwrite a newer model event with a delayed %s response', async action => {
  await useAppStore.getState().init()
  const pending = deferred<Result<ModelProfile | ModelProfile[]>>()
  const single = () => pending.promise as Promise<Result<ModelProfile>>
  const list = () => pending.promise as Promise<Result<ModelProfile[]>>
  if (action === 'verify') api.core.verifyModel = single
  else if (action === 'save') api.core.saveModel = single
  else if (action === 'create') api.core.createModel = single
  else if (action === 'delete') api.core.deleteModel = list
  else api.core.setDefaultModel = list
  const state = useAppStore.getState()
  const input = { name: model.name, provider: model.provider, endpoint: model.endpoint, key: '', model: model.model, caps: [] }
  const call = action === 'verify' ? state.verifyModel(model.id) : action === 'save' ? state.saveModel(model.id, input)
    : action === 'create' ? state.createModel() : action === 'delete' ? state.deleteModel(model.id) : state.setDefaultModel(model.id)
  const latest = [{ ...model, id: 'b', name: '新的当前服务', status: '离线' as const, tone: 'red' as const }]
  listener?.(latest)
  pending.resolve({ ok: true, data: action === 'delete' || action === 'default' ? [model] : model })
  await call
  expect(useAppStore.getState().data?.models).toEqual(latest)
  expect(useAppStore.getState().selectedModelId).toBe('b')
})

it.each([
  ['在线', '模型服务在线'], ['离线', '模型服务离线'], ['未验证', '模型服务待验证'], ['none', '模型服务未配置']
] as const)('displays the distinct service state %s', async (status, label) => {
  await useAppStore.getState().init()
  useAppStore.setState(state => ({ data: { ...state.data!, models: status === 'none' ? [] : [{ ...model, status }] } }))
  await act(async () => { render(createElement(MemoryRouter, null, createElement(TopBar))) })
  expect(screen.queryByText(label)).not.toBeNull()
})
