import { X } from 'lucide-react'
import { useAppStore } from '../store'
import { cn } from '../lib/utils'

export function ToastHost(): React.JSX.Element {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  if (!toasts.length) return <></>

  return (
    <section className="toast-stack" aria-label="操作提示" tabIndex={0}>
      {toasts.map((toast) => (
        <div key={toast.id} className={cn('toast', `toast-${toast.tone}`)} role={toast.tone === 'red' ? 'alert' : 'status'} aria-atomic="true">
          <span className="toast-mark" aria-hidden="true" />
          <span>{toast.message}{toast.count > 1 ? <small className="toast-repeat">重复 {toast.count} 次</small> : null}</span>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label={`关闭提示：${toast.message}`}>
            <X size={14} />
          </button>
        </div>
      ))}
    </section>
  )
}
