let status = '正在检查记忆服务'
let ready = false

export function ollamaStatusText(): string {
  return status
}

export function ollamaReady(): boolean {
  return ready
}

export async function refreshOllamaStatus(fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(800) })
    if (!response.ok) throw new Error('记忆服务没有响应')
    const payload = await response.json() as { models?: Array<{ name?: string }> }
    ready = payload.models?.some((model) => (model.name ?? '').includes('nomic-embed-text')) ?? false
    status = ready
      ? '记忆服务已就绪，保存的偏好会按意思被想起来。'
      : 'Ollama 已在运行，还没有记忆模型。安装完成后会下载 nomic-embed-text；没下好之前，记忆不会被带进对话。'
  } catch {
    ready = false
    status = 'Ollama 没有在运行。安装 Murasame 时会尝试一并安装。没就绪时，记忆不会被带进对话。'
  }
  return status
}
