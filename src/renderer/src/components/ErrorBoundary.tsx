import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 桌宠窗口只有几百像素宽，用小号提示，不铺满整个窗口。 */
  compact?: boolean
  /** 值变化时清掉错误状态，例如换了形象就重新尝试加载。 */
  resetKey?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error boundary', error, info.componentStack)
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    if (this.props.compact) {
      return (
        <div className="live2d-fallback" title={this.state.error.message}>
          <strong>!</strong>
          <span>形象出错了：{this.state.error.message}</span>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>重新加载形象</button>
        </div>
      )
    }
    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <div className="fatal-mark">雨</div>
          <h1>界面遇到意外错误</h1>
          <p>{this.state.error.message}</p>
          <p className="muted">日志已写入本地目录。重新载入不会上传任何会话内容。</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            重新载入界面
          </button>
        </div>
      </div>
    )
  }
}
