import log from 'electron-log/main'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

export default log
