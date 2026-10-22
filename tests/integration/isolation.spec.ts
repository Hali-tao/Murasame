import { describe, expect, it } from 'vitest'
import { containerPlan, createArgs, hostPathAllowed } from '../../src/main/isolation/docker-runtime'
import { AutonomyService } from '../../src/main/core/services/autonomy-service'

describe('[NFR-S03] 隔离性', () => {
  it('[NFR-S03] 容器默认不挂载宿主目录、不透传设备', () => {
    const plan = containerPlan()
    expect(plan.mounts).toEqual([])
    expect(plan.devices).toEqual([])
    expect(plan.network).toBe('bridge')
    expect(createArgs(plan).some((item) => item.includes('type=bind'))).toBe(false)
  })

  it('[NFR-S03] 共享目录仅限用户点名的那一个', () => {
    expect(hostPathAllowed('C:/Users/LENOVO', 'D:/share')).toBe(false)
    const shared = containerPlan({ hostPath: 'D:/share', readOnly: true })
    expect(shared.mounts).toEqual(['D:/share:/shared:ro'])
  })

  it('[NFR-S03] 隔离失效时相关活动停止', async () => {
    const service = new AutonomyService(() => 'c0ffee1234567890')
    await service.start({ dockerAvailable: true, approved: true, needsPermission: false, share: null })
    const stopped = await service.stop({ containerGone: true })
    expect(stopped.ok).toBe(true)
    if (stopped.ok) {
      expect(stopped.data.running).toBe(false)
      expect(stopped.data.hostExecution).toBe(false)
    }
  })
})
