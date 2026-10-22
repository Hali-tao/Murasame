import { describe, expect, it } from 'vitest'
import { CAPACITY_WARN_RATIO, SOFT_LIMIT_BYTES, capacityStatus, databasePath } from '../../src/main/data/capacity'

describe('[OR-02] 本地数据位置与容量', () => {
  it('[OR-02] 数据库位于用户数据目录且容量达到 80% 时提示', () => {
    expect(databasePath('C:/Users/demo/AppData/Roaming/murasame')).toMatch(/murasame\.db$/)
    expect(capacityStatus(SOFT_LIMIT_BYTES * CAPACITY_WARN_RATIO - 1).warning).toBe(false)
    const warned = capacityStatus(Math.floor(SOFT_LIMIT_BYTES * CAPACITY_WARN_RATIO))
    expect(warned.warning).toBe(true)
    expect(warned.message).toContain('80%')
  })
})
