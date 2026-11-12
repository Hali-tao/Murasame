// @vitest-environment jsdom

import { Component, createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../../src/renderer/src/components/ErrorBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

let shouldThrow = true

class ExplodingPage extends Component {
  render(): ReactNode {
    if (shouldThrow) throw new Error('页面渲染失败：测试注入')
    return createElement('div', null, '页面已恢复')
  }
}

describe('[QA-BOUNDARY-00] 控制台页面错误边界降级', () => {
  it('[QA-BOUNDARY-01] 页面抛错时只替换内容区，显示可读错误提示而不是白屏', () => {
    shouldThrow = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      createElement('div', null,
        createElement('aside', { 'data-testid': 'shell-sidebar' }, '侧边栏仍在'),
        createElement(ErrorBoundary, { mode: 'page', resetKey: '/', children: createElement(ExplodingPage) })
      )
    )
    const fallback = screen.getByTestId('page-error')
    expect(fallback.textContent).toContain('这个页面出错了')
    expect(fallback.textContent).toContain('页面渲染失败：测试注入')
    // 边界外的外壳不受影响。
    expect(screen.getByTestId('shell-sidebar').textContent).toBe('侧边栏仍在')
  })

  it('[QA-BOUNDARY-02] 路由切换（resetKey 变化）后自动清掉错误，页面重新渲染', () => {
    shouldThrow = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = render(createElement(ErrorBoundary, { mode: 'page', resetKey: '/chat', children: createElement(ExplodingPage) }))
    expect(screen.getByTestId('page-error')).toBeTruthy()
    shouldThrow = false
    act(() => {
      view.rerender(createElement(ErrorBoundary, { mode: 'page', resetKey: '/memory', children: createElement(ExplodingPage) }))
    })
    expect(screen.queryByTestId('page-error')).toBeNull()
    expect(screen.getByText('页面已恢复')).toBeTruthy()
  })

  it('[QA-BOUNDARY-03] 正常页面不受边界影响（透传渲染）', () => {
    shouldThrow = false
    render(createElement(ErrorBoundary, { mode: 'page', resetKey: '/', children: createElement('span', null, '正常内容') }))
    expect(screen.getByText('正常内容')).toBeTruthy()
    expect(screen.queryByTestId('page-error')).toBeNull()
  })
})
