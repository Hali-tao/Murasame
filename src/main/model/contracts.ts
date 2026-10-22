import { z } from 'zod'
import type { ToolDeclaration } from './types'

export const planSchema = z.object({
  steps: z.array(z.object({
    title: z.string().min(1),
    detail: z.string(),
    expected: z.string()
  })).min(1)
})

export const criticSchema = z.object({
  enough: z.boolean(),
  reason: z.string()
})

export const performanceIntentSchema = z.object({
  intent: z.enum(['打招呼', '开心', '思考', '困惑', '抱歉', '否定', '惊讶', '安抚']),
  relevance: z.number().min(0).max(1),
  consequence: z.number().min(-1).max(1),
  coping: z.number().min(0).max(1),
  norm: z.number().min(-1).max(1)
})

export const chatIntentSchema = z.object({
  kind: z.enum(['chat', 'task']),
  question: z.string()
})

export const memoryCandidateSchema = z.object({
  action: z.enum(['ADD', 'UPDATE', 'DELETE', 'NOOP']),
  category: z.enum(['user', 'feedback', 'project', 'reference']),
  text: z.string()
})

/** 隔离桌面里的下一步。done 表示目标已达成或无法继续，此时 note 写看到了什么。 */
export const desktopStepSchema = z.object({
  kind: z.enum(['click', 'type', 'key', 'done']),
  x: z.number().min(0).max(8000).optional(),
  y: z.number().min(0).max(8000).optional(),
  text: z.string().max(200).optional(),
  key: z.string().max(40).optional(),
  note: z.string().max(400).optional().default('')
})

/** 模型常在一个 JSON 后面再跟一句或第二个对象。只取第一个完整对象，避免整段解析失败。 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

/** 任务计划。信息不够时 question 写追问，步骤只描述打算做什么，执行结果另外核验。 */
export const taskPlanSchema = z.object({
  tool: z.enum(['filesystem', 'terminal', 'git', 'browser']),
  root: z.string().max(260).optional(),
  url: z.string().max(500).optional(),
  command: z.string().max(200).optional(),
  steps: z.array(z.object({
    title: z.string().min(1).max(60),
    detail: z.string().max(200),
    expected: z.string().max(200)
  })).min(1).max(6),
  question: z.string().max(200)
})

/** 一轮对话里提取出的记忆。UPDATE 和 DELETE 用 replaces 指出要替换的旧记忆原文。 */
export const memoryExtractionSchema = z.object({
  memories: z.array(z.object({
    action: z.enum(['ADD', 'UPDATE', 'DELETE']),
    category: z.enum(['user', 'feedback', 'project', 'reference']),
    text: z.string().min(1).max(200),
    replaces: z.string().max(200).optional()
  })).max(5)
})

export function toolDeclarationFromSchema(
  name: string,
  description: string,
  schema: z.ZodType
): ToolDeclaration {
  return {
    name,
    description,
    parameters: z.toJSONSchema(schema) as Record<string, unknown>
  }
}
