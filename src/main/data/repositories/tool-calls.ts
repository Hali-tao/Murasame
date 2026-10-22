import type { ToolCallRecord } from '@shared/evidence'
import type { SqliteDatabase } from '../sqlite-types'

export class ToolCallRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(record: ToolCallRecord): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls(id, task_id, step_id, tool_id, declared_json, execution_json, verification_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.taskId,
        record.stepId,
        record.toolId,
        JSON.stringify(record.declared),
        JSON.stringify(record.execution),
        JSON.stringify(record.verification),
        record.execution.startedAt
      )
  }

  listByTask(taskId: string): ToolCallRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, task_id, step_id, tool_id, declared_json, execution_json, verification_json
         FROM tool_calls WHERE task_id = ? ORDER BY created_at`
      )
      .all(taskId) as Array<{
      id: string
      task_id: string
      step_id: string
      tool_id: string
      declared_json: string
      execution_json: string
      verification_json: string
    }>
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      stepId: row.step_id,
      toolId: row.tool_id,
      declared: JSON.parse(row.declared_json) as ToolCallRecord['declared'],
      execution: JSON.parse(row.execution_json) as ToolCallRecord['execution'],
      verification: JSON.parse(row.verification_json) as ToolCallRecord['verification']
    }))
  }
}
