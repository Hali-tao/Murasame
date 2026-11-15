// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryPage } from '../../src/renderer/src/pages/MemoryPage'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { MemoryEntry, MurasameApi } from '../../src/shared/types'

const preference: MemoryEntry = { id: 'preference', category: '偏好', text: '早上喝温水', source: '手动添加', updated: '' }
const project: MemoryEntry = { ...preference, id: 'project', category: '项目', text: '周末整理项目报告' }

beforeEach(() => {
  resetStoreForTests()
  useAppStore.setState({ data: { ...initialBootstrap(), memories: [preference, project] }, loading: false })
  Object.defineProperty(window, 'murasame', { configurable: true, value: { core: {
    memoryRecallSources: vi.fn(async () => ({ ok: true, data: [] })),
    deleteMemory: vi.fn(async () => ({ ok: true, data: undefined })),
    updateMemory: vi.fn(async (id: string, category: string, text: string) => ({ ok: true, data: { ...preference, id, category, text } }))
  } } as unknown as MurasameApi })
})
afterEach(() => { cleanup(); resetStoreForTests(); vi.restoreAllMocks() })

async function mountFiltered(): Promise<void> {
  await act(async () => { render(createElement(MemoryRouter, null, createElement(MemoryPage))) })
  fireEvent.change(screen.getByRole('combobox', { name: '筛选类别' }), { target: { value: '偏好' } })
}

async function deletePreference(): Promise<void> {
  fireEvent.click(within(screen.getByTestId('memory-card')).getByRole('button', { name: '删除' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除记忆' })) })
}

describe('[FR-15] 记忆类别变化后的筛选一致性', () => {
  it('[FR-15] 删除当前类别最后一条记忆后展示仍存在的其它记忆', async () => {
    await mountFiltered()
    await deletePreference()
    expect(screen.getByRole('combobox', { name: '筛选类别' })).toHaveValue('全部类别')
    expect(screen.getByTestId('memory-card')).toHaveTextContent(project.text)
    expect(screen.queryByText('没有匹配的记忆')).not.toBeInTheDocument()
  })

  it('[FR-15] 更正最后一条记忆的类别后同步筛选值和结果', async () => {
    await mountFiltered()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByTestId('memory-category'), { target: { value: '项目' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存更正' })) })
    expect(screen.getByRole('combobox', { name: '筛选类别' })).toHaveValue('全部类别')
    expect(screen.getAllByTestId('memory-card')).toHaveLength(2)
    expect(useAppStore.getState().data?.memories.every(memory => memory.category === '项目')).toBe(true)
  })

  it('[FR-15] 已回退的类别重新出现时不会悄悄恢复旧筛选', async () => {
    await mountFiltered()
    await deletePreference()
    await act(async () => {
      useAppStore.setState(state => ({ data: { ...state.data!, memories: [...state.data!.memories, { ...preference, id: 'new-preference' }] } }))
    })
    expect(screen.getByRole('combobox', { name: '筛选类别' })).toHaveValue('全部类别')
    expect(screen.getAllByTestId('memory-card')).toHaveLength(2)
  })

  it('[FR-15] 当前类别仍有记忆时保留类别选择与搜索条件', async () => {
    const retained = { ...preference, id: 'retained', text: '早上喝温水并散步' }
    useAppStore.setState(state => ({ data: { ...state.data!, memories: [...state.data!.memories, retained] } }))
    await mountFiltered()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索记忆' }), { target: { value: '早上' } })
    fireEvent.click(within(screen.getAllByTestId('memory-card')[0]).getByRole('button', { name: '删除' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '删除记忆' })) })
    expect(screen.getByRole('combobox', { name: '筛选类别' })).toHaveValue('偏好')
    expect(screen.getByRole('textbox', { name: '搜索记忆' })).toHaveValue('早上')
    expect(screen.getByTestId('memory-card')).toHaveTextContent(retained.text)
  })
})
