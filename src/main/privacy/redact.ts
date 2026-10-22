export function safeLogLine(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{16,}/gi, '[已省略屏幕图像]')
}

export function logExpired(ageDays: number, retentionDays = 14): boolean {
  return ageDays > retentionDays
}

export function httpsOnly(endpoint: string): boolean {
  return endpoint.startsWith('https://') || endpoint.startsWith('http://127.0.0.1') || endpoint.startsWith('http://localhost')
}
