import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capabilityOf } from '../../src/shared/avatar/capability'
import {
  applyMeshPose,
  buildMesh,
  MESH_GRID,
  MESH_WEIGHT_IDS,
  meshBlinkAt,
  meshBoneMatrices,
  meshFit,
  meshMouthShape,
  meshPoseAt,
  meshRawWeights,
  meshToDisplay,
  type MeshPetState
} from '../../src/shared/avatar/mesh-pose'
import { getPetPreset, PET_PRESETS } from '../../src/shared/pet-presets'
import { petWorkMotion, type PetWorkState } from '../../src/shared/pet-work'

const STATES: MeshPetState[] = ['idle', 'greet', 'think', 'agree', 'confused', 'working', 'settle']
const VIEW = { width: 326, height: 440 }
const fit = meshFit(VIEW.width, VIEW.height)

function signedArea(vertices: Float64Array, a: number, b: number, c: number): number {
  return (
    (vertices[b * 2] - vertices[a * 2]) * (vertices[c * 2 + 1] - vertices[a * 2 + 1]) -
    (vertices[c * 2] - vertices[a * 2]) * (vertices[b * 2 + 1] - vertices[a * 2 + 1])
  ) / 2
}

function work(phase: PetWorkState['phase']): PetWorkState {
  return { key: `synthetic:${phase}`, source: 'task', phase, label: '', detail: '', busy: false, targetPath: '' }
}

describe('[FR-09] 奶龙官方形象预设', () => {
  it('[FR-09] 预设存在且贴图在仓库内', () => {
    const preset = getPetPreset('nailong')
    expect(preset.id).toBe('nailong')
    expect(preset.format.startsWith('Mesh')).toBe(true)
    expect(preset.modelUrl.startsWith('pets/nailong/')).toBe(true)
    expect(existsSync(resolve('src/renderer/public', preset.modelUrl))).toBe(true)
    expect(PET_PRESETS.map(item => item.id)).toContain('nailong')
  })

  it('[FR-09] 能力表声明了网格状态与口型/眨眼参数', () => {
    const capability = capabilityOf('nailong')
    expect(capability.motions).toEqual(expect.arrayContaining(['Idle', 'Greet', 'Think', 'Agree', 'Confused', 'Working']))
    expect(capability.parameters).toEqual(expect.arrayContaining(['mouth', 'eye', 'head', 'breath']))
  })

  it('[FR-16] 任务状态映射到网格动作', () => {
    expect(petWorkMotion(work('working'), 'nailong', false)).toMatchObject({ motion: 'Working', loop: true })
    expect(petWorkMotion(work('waiting'), 'nailong', false)).toMatchObject({ motion: 'Think', loop: true })
    expect(petWorkMotion(work('ready'), 'nailong', false)).toMatchObject({ motion: 'Agree', loop: false })
    expect(petWorkMotion(work('failed'), 'nailong', false)).toMatchObject({ motion: 'Confused', loop: false })
    expect(petWorkMotion(work('working'), 'nailong', true)).toBeNull()
  })
})

describe('[FR-02] 连续网格形变', () => {
  it('[FR-02] 网格顶点与权重在源图范围内归一', () => {
    const built = buildMesh(fit, 2)
    expect(built.vertices).toBe((MESH_GRID.cols + 1) * (MESH_GRID.rows + 1))
    expect(built.triangles).toBe(MESH_GRID.cols * MESH_GRID.rows * 2)
    let maxError = 0
    for (const weight of built.weights) {
      let sum = 0
      for (const id of MESH_WEIGHT_IDS) sum += weight[id]
      maxError = Math.max(maxError, Math.abs(sum - 1))
    }
    expect(maxError).toBeLessThan(1e-12)
    for (const value of built.rest) expect(Number.isFinite(value)).toBe(true)
    for (const uv of built.uvs) {
      expect(uv).toBeGreaterThanOrEqual(0)
      expect(uv).toBeLessThanOrEqual(1)
    }
    for (const index of built.indices) expect(index).toBeLessThan(built.vertices)
  })

  it('[FR-02] 区域权重在关节处连续过渡', () => {
    const head = meshRawWeights(278, 120)
    expect(head.head).toBeGreaterThan(0.5)
    const foot = meshRawWeights(206, 455)
    expect(foot.shinL).toBeGreaterThan(0.5)
    const arm = meshRawWeights(150, 210)
    expect(arm.armL).toBeGreaterThan(0.2)
  })

  it('[FR-02] 同一时刻与时间的姿态是确定性的', () => {
    for (const state of STATES) {
      const first = meshPoseAt(state, 2.4, 0.7, 0.4)
      const second = meshPoseAt(state, 2.4, 0.7, 0.4)
      expect(second).toEqual(first)
      for (const value of Object.values(first)) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('[FR-02] 各状态形变后顶点有限且三角形不翻折', () => {
    const built = buildMesh(fit, 2)
    const display = new Float64Array(built.rest.length)
    const restAreas = new Float64Array(built.triangles)
    for (let triangle = 0; triangle < built.triangles; triangle += 1) {
      const a = built.indices[triangle * 3]
      const b = built.indices[triangle * 3 + 1]
      const c = built.indices[triangle * 3 + 2]
      restAreas[triangle] = signedArea(built.rest, a, b, c)
    }
    for (const state of STATES) {
      for (const time of [0, 1.3, 3.96, 6.2]) {
        const pose = meshPoseAt(state, time, Math.min(time, 1.4), 0)
        const matrices = meshBoneMatrices(pose, fit)
        applyMeshPose(built.rest, built.weights, matrices, display)
        for (const value of display) expect(Number.isFinite(value)).toBe(true)
        let flipped = 0
        for (let triangle = 0; triangle < built.triangles; triangle += 1) {
          const a = built.indices[triangle * 3]
          const b = built.indices[triangle * 3 + 1]
          const c = built.indices[triangle * 3 + 2]
          const area = signedArea(display, a, b, c)
          if (area * restAreas[triangle] <= 0 || Math.abs(area) < 0.01) flipped += 1
        }
        expect(flipped).toBe(0)
      }
    }
  })

  it('[FR-02] 位移幅度足够可见但不会撕裂画面', () => {
    const built = buildMesh(fit, 2)
    const display = new Float64Array(built.rest.length)
    const pose = meshPoseAt('idle', 2.0, 2.0, 0)
    applyMeshPose(built.rest, built.weights, meshBoneMatrices(pose, fit), display)
    let max = 0
    for (let i = 0; i < display.length; i += 2) {
      max = Math.max(max, Math.hypot(display[i] - built.rest[i], display[i + 1] - built.rest[i + 1]))
    }
    expect(max).toBeGreaterThan(4)
    expect(max).toBeLessThan(60)
  })
})

describe('[FR-01] 眨眼与口型', () => {
  it('[FR-02] 眨眼比例始终在 0..1 并在周期内闭眼一次', () => {
    let closed = 0
    for (let time = 0; time < 10; time += 0.01) {
      const value = meshBlinkAt(time)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      if (value > 0.8) closed += 1
    }
    expect(closed).toBeGreaterThan(10)
    expect(meshBlinkAt(3.96)).toBeGreaterThan(0.3)
    expect(meshBlinkAt(0)).toBe(0)
  })

  it('[FR-01] 说话口型随音量打开并在无语音时闭合', () => {
    const silent = meshMouthShape(0, 1)
    expect(silent.open).toBe(0)
    const speaking = meshMouthShape(1, 1)
    expect(speaking.open).toBeGreaterThan(0.5)
    expect(speaking.rx).toBeGreaterThan(0)
    expect(speaking.ry).toBeGreaterThan(0)
    expect(speaking.offsetY).toBeGreaterThan(0)
  })

  it('[FR-02] 眨眼与口型跟随头部矩阵，不脱离面部位置', () => {
    const pose = meshPoseAt('idle', 1, 1, 0.6)
    const matrices = meshBoneMatrices(pose, fit)
    const [x, y] = meshToDisplay(fit, 297, 166)
    const [mx, my] = [
      matrices.head[0] * x + matrices.head[2] * y + matrices.head[4],
      matrices.head[1] * x + matrices.head[3] * y + matrices.head[5]
    ]
    expect(mx).toBeGreaterThan(60)
    expect(mx).toBeLessThan(VIEW.width - 60)
    expect(my).toBeGreaterThan(20)
    expect(my).toBeLessThan(VIEW.height - 20)
  })
})
