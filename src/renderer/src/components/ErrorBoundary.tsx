import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
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

  render(): ReactNode {
    if (!this.state.error) return this.props.children
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
