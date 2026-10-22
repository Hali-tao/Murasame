import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { X } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import type { Tone } from '@shared/types'
import { cn } from '../lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
  size?: 'sm' | 'md'
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
}

export function IconButton({ label, className, children, ...props }: IconButtonProps): React.JSX.Element {
  return (
    <button type="button" className={cn('icon-btn', className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function Card({
  children,
  className,
  as: Tag = 'section',
  ...props
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>): React.JSX.Element {
  return <Tag className={cn('card', className)} {...props}>{children}</Tag>
}

export function CardHead({
  title,
  subtitle,
  aside,
  className
}: {
  title: ReactNode
  subtitle?: ReactNode
  aside?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('card-head', className)}>
      <div>
        <h2 className="card-title">{title}</h2>
        {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
      </div>
      {aside ? <div className="card-head-aside">{aside}</div> : null}
    </div>
  )
}

export function Pill({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }): React.JSX.Element {
  return <span className={cn('pill', `pill-${tone}`, className)}>{children}</span>
}

export function StatTile({
  label,
  value,
  caption,
  tone = 'coral'
}: {
  label: string
  value: ReactNode
  caption: ReactNode
  tone?: Tone
}): React.JSX.Element {
  return (
    <Card className="stat-tile">
      <div className="stat-topline">
        <span>{label}</span>
        <span className={cn('stat-dot', `dot-${tone}`)} />
      </div>
      <strong>{value}</strong>
      <p>{caption}</p>
    </Card>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={cn('field', className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={cn('input', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return <textarea className={cn('input textarea', className)} {...props} />
}

export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled,
  label
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      className="switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
    >
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled
}: {
  title: string
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-title">{title}</div>
        {description ? <div className="toggle-description">{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} label={title} />
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="加载中" />
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string
  description?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-symbol">雨</div>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function Divider({ className }: { className?: string }): React.JSX.Element {
  return <div className={cn('divider', className)} />
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = '520px'
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: string
}): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog-content" style={{ maxWidth: width }}>
          <div className="dialog-header">
            <div>
              <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={cn('dialog-description', !description && 'sr-only')}>
                {description ?? title}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="icon-btn" aria-label="关闭">
              <X size={17} />
            </DialogPrimitive.Close>
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-footer">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'coral',
  onConfirm,
  busy
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'coral' | 'red' | 'green'
  onConfirm: () => void | Promise<void>
  busy?: boolean
}): React.JSX.Element {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'red' ? 'danger' : 'primary'}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}
