import log from 'electron-log/main'
import { safeLogLine } from './privacy/redact'

log.initialize()

// 排错信息要能定位失败，但不记录完整密钥与原始屏幕内容。
log.hooks.push((message) => ({
  ...message,
  data: message.data.map((item) => (typeof item === 'string' ? safeLogLine(item) : item))
}))
log.transports.file.level = 'info'
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

export default log
