export interface ParsedError {
  kind: string
  file: string
  line: string
  message: string
}

const patterns: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'Python Traceback', pattern: /File "([^"]+)", line (\d+).*\n(?:.*\n)*?(\w*(?:Error|Exception): .+)/ },
  { kind: 'Node 堆栈', pattern: /at .+\(([^():]+):(\d+):\d+\)[\s\S]*?(Error: .+)/ },
  { kind: '编译错误', pattern: /([^:\s]+\.(?:c|cc|cpp|h|rs|go)):(\d+):\d+: error: (.+)/ },
  { kind: 'HTTP 状态码', pattern: /\bHTTP(?:\/\d(?:\.\d)?)?\s+([45]\d\d)\b[^\n]*?(?:[:：]\s*(.+))?/ },
  { kind: 'Windows 错误码', pattern: /(?:错误|error)\s*(?:代码|code)?\s*[:：]?\s*(0x[0-9a-fA-F]+|\d{3,})[^\n]*?(?:[:：]\s*(.+))?/ }
]

export function parseKnownError(text: string): ParsedError | null {
  for (const rule of patterns) {
    const match = rule.pattern.exec(text)
    if (!match) continue
    if (rule.kind === 'HTTP 状态码') {
      return { kind: rule.kind, file: '', line: '', message: `HTTP ${match[1]}${match[2] ? ` ${match[2]}` : ''}` }
    }
    if (rule.kind === 'Windows 错误码') {
      return { kind: rule.kind, file: '', line: '', message: `${match[1]}${match[2] ? ` ${match[2]}` : ''}` }
    }
    return { kind: rule.kind, file: match[1] ?? '', line: match[2] ?? '', message: (match[3] ?? '').trim() }
  }
  return null
}

export function needsMoreContext(text: string, parsed: ParsedError | null): boolean {
  const compact = text.replace(/\s+/g, '')
  return !parsed && compact.length < 8
}
