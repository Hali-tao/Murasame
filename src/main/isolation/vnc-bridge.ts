import { containerPlan, dockerUnavailableMessage } from './docker-runtime'

export interface VncView {
  connected: boolean
  url: string
  hostExecution: false
  message: string
}

export function vncView(available: boolean, port = 6901): VncView {
  if (!available) {
    return { connected: false, url: '', hostExecution: false, message: dockerUnavailableMessage() }
  }
  return {
    connected: true,
    url: `http://127.0.0.1:${port}/vnc.html?autoconnect=1&resize=scale`,
    hostExecution: false,
    message: '画面来自隔离桌面'
  }
}

export function containerPlanForView(): ReturnType<typeof containerPlan> {
  return containerPlan()
}
