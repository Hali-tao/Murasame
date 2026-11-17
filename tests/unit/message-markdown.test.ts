// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageMarkdown } from '../../src/renderer/src/components/MessageMarkdown'
import { MessageCopy } from '../../src/renderer/src/components/MessageCopy'
import { normalizeMathDelimiters } from '../../src/renderer/src/components/math-markdown'

const copyText = vi.fn()
beforeEach(() => {
  copyText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'murasame', { configurable: true, value: { app: { copyText } } })
})
afterEach(cleanup)
const draw = (text: string, streaming = false) => createElement(MessageMarkdown, { text, streaming })

it('renders model LaTeX and dollar delimiters, preserving exact source', () => {
  const source = String.raw`渲染方程：
\[
L_o(x,\omega_o)=L_e(x,\omega_o)+\int_{\Omega} f_r(x,\omega_i,\omega_o)L_i(x,\omega_i)\cos\theta_i\,d\omega_i
\]

行内 \(x_i^2\) 与 $E=mc^2$。

$$
\frac{a}{b}
$$`
  const { container } = render(draw(source))
  expect(container.querySelectorAll('.katex')).toHaveLength(4)
  expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
  expect(container.querySelectorAll('.katex-error')).toHaveLength(0)
  expect(container.querySelector('math')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
  expect(container.querySelector('.message-source pre')?.textContent).toBe(source)
})

it('keeps LaTeX examples in code literal and copies them unchanged', async () => {
  const code = String.raw`\[x_i\] and \(y\) and $z$`
  const source = '`' + code + '`\n\n~~~tex\n' + code + '\n~~~\n\n    ' + code
  expect(normalizeMathDelimiters(source)).toBe(source)
  const { container } = render(draw(source))
  expect(container.querySelectorAll('.katex')).toHaveLength(0)
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '复制代码' })[0]) })
  expect(copyText).toHaveBeenCalledWith(code)
  expect(normalizeMathDelimiters('```tex\n' + code)).toBe('```tex\n' + code)
})

it('handles incomplete streaming math and invalid expressions without breaking the reply', () => {
  const view = render(draw(String.raw`公式 \[\frac{a`, true))
  expect(view.container.querySelectorAll('.katex')).toHaveLength(0)
  view.rerender(draw(String.raw`公式 \[\frac{a}{b}\]`, false))
  expect(view.container.querySelectorAll('.katex-display')).toHaveLength(1)
  view.rerender(draw('$\\frac{a$\n\n后续正文', true))
  expect(view.container.querySelector('.katex-error')).toBeInTheDocument()
  expect(screen.getByText('后续正文')).toBeVisible()
})

it('does not enable HTML, remote resources or unsafe links through math', () => {
  const { container } = render(draw(String.raw`$\href{javascript:alert(1)}{click}$

$\includegraphics{https://example.com/track.png}$

$\htmlStyle{background:url(https://example.com/track.png)}{x}$`))
  expect(container.querySelectorAll('a, img, script, iframe')).toHaveLength(0)
  expect(container.querySelector('[style*="example.com"]')).toBeNull()
})

it('preserves escaped delimiters and math nested inside blockquotes and lists', () => {
  expect(normalizeMathDelimiters(String.raw`\\[literal\\]`)).toBe(String.raw`\\[literal\\]`)
  const { container } = render(draw('> \\[\n> x_i\n> \\]\n\n- 公式\n\n  \\[\n  y_i\n  \\]'))
  expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
  expect(container.querySelectorAll('.katex-error')).toHaveLength(0)
})

it('copies complete message source, reports failures, and resets feedback when content changes', async () => {
  const text = '**重点**\n\n```js\n\tconst x = 1;  \n```'
  const view = render(createElement(MessageCopy, { text, role: 'assistant' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制回复' })) })
  expect(copyText).toHaveBeenCalledWith(text)
  expect(screen.getByRole('status')).toHaveTextContent('已复制')
  view.rerender(createElement(MessageCopy, { text: '用户消息', role: 'user' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  copyText.mockRejectedValue(new Error('clipboard unavailable'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制消息' })) })
  expect(screen.getByRole('status')).toHaveTextContent('复制失败')
})

it('can render console messages without the source toggle', () => {
  render(createElement(MessageMarkdown, { text: '**内容**', showSource: false }))
  expect(screen.queryByRole('button', { name: '查看原文' })).not.toBeInTheDocument()
  expect(screen.getByText('内容')).toBeVisible()
})

it('[FR-01] formats headings, emphasis, lists, links and tables while keeping exact source available', () => {
  const source = '# 标题\n\n**重点** 与 *强调*\n\n- 第一项\n- 第二项\n\n[文档](https://example.com/docs)\n\n| 名称 | 值 |\n| --- | --- |\n| 项目 | 1 |'
  const { container } = render(draw(source))
  expect(screen.getByRole('heading', { name: '标题' })).toBeVisible()
  expect(container.querySelector('strong')).toHaveTextContent('重点')
  expect(container.querySelector('em')).toHaveTextContent('强调')
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByRole('table')).toHaveTextContent('项目')
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
  fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
  expect(container.querySelector('.message-source pre')?.textContent).toBe(source)
})

it('[NFR-S01] raw HTML is text, unsafe links are inert and images never load automatically', () => {
  const source = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29) [file](file:///C:/secret) [internal](murasame://app) [relative](/settings) [credentials](https://user:password@example.com) ![remote](https://example.com/track.png)'
  const { container } = render(draw(source))
  expect(container.querySelectorAll('script, img, iframe, a')).toHaveLength(0)
  expect(container.querySelector('.message-markdown')).toHaveTextContent('<script>alert(1)</script>')
  expect(screen.getByText('[图片：remote]')).toBeVisible()
})

it('[FR-01] copies only code with indentation, tabs, trailing spaces and blank lines preserved', async () => {
  const code = '  const value = 1;\n\t// 注释  \n'
  render(draw(`~~~ts\n${code}\n~~~`))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制代码' })) })
  expect(copyText).toHaveBeenCalledWith(code)
  expect(screen.getByRole('status')).toHaveTextContent('已复制')
})

it('[FR-01] incomplete streaming fences render as code and feedback does not survive changed content', async () => {
  const view = render(draw('```js\nconst value =', true))
  expect(view.container.querySelector('.markdown-code-block code')).toHaveTextContent('const value =')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制代码' })) })
  expect(copyText).toHaveBeenLastCalledWith('const value =')
  expect(screen.getByRole('status')).toHaveTextContent('已复制当前片段')
  view.rerender(draw('```js\nconst value = 42;\n```', false))
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  expect(view.container.querySelector('.markdown-code-block code')?.textContent).toBe('const value = 42;')
  view.rerender(draw('[未完成](https://example.com', true))
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  view.rerender(draw('[已完成](https://example.com)', false))
  expect(screen.getByRole('link', { name: '已完成' })).toHaveAttribute('href', 'https://example.com')
})

it('[FR-01] clipboard rejection reports failure rather than success', async () => {
  copyText.mockRejectedValue(new Error('clipboard unavailable'))
  render(draw('```\nhello\n```'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制代码' })) })
  expect(screen.getByRole('status')).toHaveTextContent('复制失败')
  expect(screen.getByRole('status')).not.toHaveTextContent('已复制')
})
