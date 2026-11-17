// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { Task, TaskStatus } from '../../src/shared/types'
import { DashboardPage } from '../../src/renderer/src/pages/DashboardPage'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

vi.mock('../../src/renderer/src/components/AffectWeatherCard', () => ({ AffectWeatherCard: () => null }))
vi.mock('../../src/renderer/src/components/DailyRecapCard', () => ({ DailyRecapCard: () => null }))
afterEach(() => { cleanup(); resetStoreForTests() })
const task = (id: string, status: TaskStatus): Task => ({
  id, title: id, status, tone: 'blue', progress: 100 / 3, created: '', model: '', modelProfileId: null,
  scope: '', summary: '任务说明', steps: [], artifacts: [], approval: null, result: '', toolCalls: [], verdict: null
})
function Location(): React.JSX.Element { const value = useLocation(); return createElement('output', { 'data-testid': 'location' }, value.pathname + value.search) }
const draw = (): ReturnType<typeof render> => render(createElement(MemoryRouter, null, createElement(DashboardPage), createElement(Location)))

it('prioritizes approvals, excludes terminal tasks and rounds progress without changing it', () => {
  useAppStore.setState({ data: { ...initialBootstrap(), tasks: [task('finished', '已完成'), task('running', '执行中'), task('approval', '等待批准'), task('draft', '待确认')] } })
  const { container } = draw()
  expect(screen.queryByText('finished')).toBeNull()
  expect([...container.querySelectorAll('.dashboard-task h3')].map(node => node.textContent)).toEqual(['approval', 'draft', 'running'])
  expect(container.querySelector('.dashboard-secondary')).toHaveTextContent('2 项待确认 · 1 项进行中')
  expect(container.querySelector('.progress-line')).toHaveTextContent('33.3%')
  expect(useAppStore.getState().data?.tasks[1].progress).toBe(100 / 3)
  fireEvent.click(screen.getAllByRole('button', { name: '查看并确认' })[0])
  expect(screen.getByTestId('location')).toHaveTextContent('/tasks?focus=approval')
})

it('shows an honest empty task state when all tasks are finished', () => {
  useAppStore.setState({ data: { ...initialBootstrap(), tasks: [task('finished', '已完成'), task('cancelled', '已取消')] } })
  draw()
  expect(screen.getByText('暂无待处理任务')).toBeVisible()
  expect(screen.queryByRole('heading', { name: '待处理任务' })).toBeNull()
  expect(screen.queryByRole('button', { name: '查看进度' })).toBeNull()
})

it('opens the chosen conversation instead of the previously selected one', () => {
  const setActiveConversation = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'murasame', { configurable: true, value: { core: { setActiveConversation } } })
  useAppStore.setState({ data: { ...initialBootstrap(), conversations: [
    { id: 'empty', title: '只有问候的新对话', preview: '我在。', time: '刚刚', count: 1, pinned: false, messages: [{ id: 'g', role: 'assistant', text: '我在。', time: '' }] },
    { id: 'recent', title: '最近的会话', preview: '内容', time: '11月17日 20:00', count: 1, pinned: false, messages: [{ id: 'u', role: 'user', text: '内容', time: '' }] },
    { id: 'older', title: '之前的会话', preview: '内容', time: '11月16日 20:00', count: 1, pinned: false, messages: [{ id: 'u2', role: 'user', text: '内容', time: '' }] }
  ] }, selectedConversationId: 'older' })
  draw()
  expect(screen.queryByText('只有问候的新对话')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '继续交流' }))
  expect(useAppStore.getState().selectedConversationId).toBe('recent')
  fireEvent.click(screen.getByRole('button', { name: /之前的会话/ }))
  expect(setActiveConversation).toHaveBeenLastCalledWith('older')
  expect(screen.getByTestId('location')).toHaveTextContent('/chat')
})

it('creates a new conversation from the empty state', async () => {
  const createConversation = vi.fn().mockResolvedValue({ id: 'new' })
  useAppStore.setState({ data: { ...initialBootstrap(), conversations: [] }, createConversation })
  draw()
  fireEvent.click(screen.getByRole('button', { name: '开始交流' }))
  expect(createConversation).toHaveBeenCalledOnce()
  await screen.findByText('/chat')
})
