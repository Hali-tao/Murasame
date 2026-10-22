import { X } from 'lucide-react'
import { useAppStore } from '../store'
import { cn } from '../lib/utils'

export function ToastHost(): React.JSX.Element {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cn('toast', `toast-${toast.tone}`)}>
          <span className="toast-mark" />
          <span>{toast.message}</span>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
