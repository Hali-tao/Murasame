// @vitest-environment jsdom

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MemoryEntry, MemoryRecallSource, MurasameApi } from '../../src/shared/types'
import { initialBootstrap } from '../../src/shared/mock-data'
import { MemoryPage } from '../../src/renderer/src/pages/MemoryPage'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

const memory: MemoryEntry = { id: 'mem-1', category: '偏好', text: '我喜欢早上喝温水', source: '长期记忆', updated: '有效' }

const source: MemoryRecallSource = {
  memoryId: 'mem-1',
  conversationId: 'chat-1',
  conversationTitle: '早上的对话',
  turnId: 'turn-3',
  at: '2026-11-13T03:00:00.000Z',
  count: 3,
  recent: [
    { conversationId: 'chat-1', conversationTitle: '早上的对话', turnId: 'turn-3', at: '2026-11-13T03:00:00.000Z' },
    { conversationId: 'chat-2', conversationTitle: '昨晚的对话', turnId: 'turn-2', at: '2026-11-12T13:00:00.000Z' }
  ]
}

function mountApi(recall: MemoryRecallSource[] | null): void {
  Object.defineProperty(window, 'murasame', {
    configurable: true,
    value: {
      core: {
        memoryRecallSources: vi.fn(async () => (recall === null ? { ok: false as const, error: '数据库暂时不可用' } : { ok: true as const, data: recall }))
      }
    } as unknown as MurasameApi
  })
}

function mountPage(): void {
  const data = { ...initialBootstrap(), memories: [memory] }
  useAppStore.setState({ data, loading: false })
  render(createElement(MemoryRouter, null, createElement(MemoryPage)))
}

describe('[QA-MEMUI-00] 记忆房间来源链 UI（次数与最近来源详情）', () => {
  beforeEach(() => {
    resetStoreForTests()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('[QA-MEMUI-01] 已召回记忆显示「被想起 N 次」并可展开最近来源', async () => {
    mountApi([source])
    mountPage()
    await waitFor(() => expect(screen.getByTestId('memory-recall-count')).toBeTruthy())
    expect(screen.getByTestId('memory-recall-count').textContent).toBe('被想起 3 次')
    expect(screen.getByTestId('memory-recall-source').textContent).toContain('早上的对话')
    const detail = screen.getByTestId('memory-recall-detail')
    expect(detail.textContent).toContain('查看最近 2 次来源')
    fireEvent.click(detail.querySelector('summary') as HTMLElement)
    expect(detail.textContent).toContain('昨晚的对话')
  })

  it('[QA-MEMUI-02] 从未被真正想起的记忆显示诚实空状态，不显示次数', async () => {
    mountApi([])
    mountPage()
    await waitFor(() => expect(screen.getByTestId('memory-recall-source').textContent).toBe('还没有被真正想起过'))
    expect(screen.queryByTestId('memory-recall-count')).toBeNull()
    expect(screen.queryByTestId('memory-recall-detail')).toBeNull()
  })

  it('[QA-MEMUI-03] 召回记录读取失败时显示「暂时读不到」，不伪装成从未想起', async () => {
    mountApi(null)
    mountPage()
    await waitFor(() => expect(screen.getByTestId('memory-recall-source').textContent).toBe('召回记录暂时读不到'))
    expect(screen.queryByTestId('memory-recall-count')).toBeNull()
  })
})
