import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function clockLabel(date = new Date()): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function dateLabel(date = new Date()): string {
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export function weekdayLabel(date = new Date()): string {
  return date.toLocaleDateString('zh-CN', { weekday: 'long' }).toUpperCase()
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function initials(name: string): string {
  return name.trim().slice(0, 1) || 'M'
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}
