// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { Task } from '../../src/shared/types'
import { TasksPage } from '../../src/renderer/src/pages/TasksPage'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

beforeEach(resetStoreForTests)
afterEach(() => { cleanup(); resetStoreForTests() })

describe('[FR-19] 任务进度显示', () => {
  it.each([
    [100 / 3, '33.3%'],
    [200 / 3, '66.7%'],
    [0, '0%'],
    [100, '100%']
  ])('[FR-19] 列表、详情与查询提示将 %s 显示为 %s', (progress, label) => {
    const task: Task = {
      id: 'progress-task', title: '三步目录任务', status: '等待批准', tone: 'amber',
      progress, created: '', model: '', modelProfileId: null, scope: '',
      summary: '等待下一步批准', steps: [], artifacts: [], approval: null,
      result: '', toolCalls: [], verdict: null
    }
    useAppStore.setState({ data: { ...initialBootstrap(), tasks: [task] }, loading: false })
    const view = render(createElement(MemoryRouter, null, createElement(TasksPage)))

    expect(view.container.querySelector('.task-list-meta')).toHaveTextContent(label)
    expect(view.container.querySelector('.task-progress-card')).toHaveTextContent(`${label} · 等待批准`)
    fireEvent.click(screen.getByRole('button', { name: '查询进度' }))
    expect(useAppStore.getState().toasts.at(-1)?.message).toBe(`等待批准 · ${label} · 等待下一步批准`)
    expect(useAppStore.getState().data?.tasks[0].progress).toBe(progress)
  })
})
