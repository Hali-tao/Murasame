import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('[NFR-M02] 追溯编号解析', () => {
  it('[NFR-M02] 从测试标题解析需求编号', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { requirementIdsIn } from './scripts/traceability.mjs'; process.stdout.write(JSON.stringify(requirementIdsIn("it('[FR-21] 部分完成')\\nit('[NFR-S01] 加密')")))`
      ],
      { cwd: root, encoding: 'utf8' }
    )
    expect(JSON.parse(output)).toEqual(['FR-21', 'NFR-S01'])
  })
})
