/**
 * 奶龙官方面板的连续网格姿态数学。
 *
 * 坐标系：官方源图按 500×500 记录（贴图可以是 2× 的 1000×1000，UV 由渲染层换算）。
 * 本模块不依赖 pixi/React，可单独测试：区域权重、待机与反应姿态、眨眼、口型、骨骼矩阵。
 */

export const MESH_SOURCE = { width: 500, height: 500 } as const
/** 官方图 alpha 边界 (110,25)-(451,474) 加 4px 透明边。 */
export const MESH_CROP = { x: 106, y: 21, width: 350, height: 460 } as const
export const MESH_GRID = { cols: 30, rows: 40 } as const
export const MESH_MARGIN = { x: 8, top: 10, bottom: 8 } as const

export type MeshPetState = 'idle' | 'greet' | 'think' | 'agree' | 'confused' | 'working' | 'settle'
export type MeshBoneId = 'head' | 'chest' | 'belly' | 'hips' | 'torso' | 'armL' | 'armR' | 'shinL' | 'shinR'
export type MeshWeightId = Exclude<MeshBoneId, 'torso'>

export interface MeshFit {
  scale: number
  originX: number
  originY: number
}

export interface MeshPose {
  headTiltDeg: number
  headNodDeg: number
  headTurn: number
  headTurnScale: number
  armLDeg: number
  armRDeg: number
  hipSway: number
  hipAngleDeg: number
  torsoAngleDeg: number
  chestLift: number
  chestScaleX: number
  chestScaleY: number
  bellyScaleX: number
  bellyScaleY: number
}

export interface MeshMatrices {
  head: number[]
  chest: number[]
  belly: number[]
  hips: number[]
  torso: number[]
  armL: number[]
  armR: number[]
  shinL: number[]
  shinR: number[]
}

/** 源图 500 坐标系下的骨骼枢轴。 */
export const MESH_BONES: Readonly<Record<MeshBoneId, { pivot: readonly [number, number]; parent: MeshBoneId | null }>> = {
  head: { pivot: [278, 214], parent: 'chest' },
  chest: { pivot: [278, 262], parent: 'torso' },
  belly: { pivot: [278, 352], parent: 'torso' },
  hips: { pivot: [278, 430], parent: null },
  torso: { pivot: [278, 380], parent: 'hips' },
  armL: { pivot: [196, 248], parent: 'chest' },
  armR: { pivot: [360, 248], parent: 'chest' },
  shinL: { pivot: [206, 452], parent: null },
  shinR: { pivot: [350, 452], parent: null }
}

export const MESH_WEIGHT_IDS: readonly MeshWeightId[] = ['head', 'chest', 'belly', 'hips', 'armL', 'armR', 'shinL', 'shinR']

/** 面部在源图 500 坐标系中的位置，用于眨眼与口型叠加层。 */
export const MESH_FACE = {
  eyeL: [236, 116] as const,
  eyeR: [338, 108] as const,
  eyeRadiusL: [39, 28] as const,
  eyeRadiusR: [36, 26] as const,
  mouth: [297, 166] as const,
  mouthRadius: 9.5
} as const

const TAU = Math.PI * 2
const DEG = Math.PI / 180

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp01((value - edge0) / (edge1 - edge0))
  return x * x * (3 - 2 * x)
}

/** 把源图坐标铺进实际画布；画布尺寸随桌宠缩放变化。 */
export function meshFit(viewWidth: number, viewHeight: number): MeshFit {
  const scale = Math.min(
    (viewWidth - MESH_MARGIN.x * 2) / MESH_CROP.width,
    (viewHeight - MESH_MARGIN.top - MESH_MARGIN.bottom) / MESH_CROP.height
  )
  return {
    scale,
    originX: (viewWidth - MESH_CROP.width * scale) / 2 - MESH_CROP.x * scale,
    originY: viewHeight - MESH_MARGIN.bottom - (MESH_CROP.y + MESH_CROP.height) * scale
  }
}

export function meshToDisplay(fit: MeshFit, x: number, y: number): [number, number] {
  return [fit.originX + x * fit.scale, fit.originY + y * fit.scale]
}

/** 未归一化的解剖权重（源图 500 坐标）。 */
export function meshRawWeights(x: number, y: number): Record<MeshWeightId, number> {
  const cx = 278
  const head = (1 - smoothstep(190, 238, y)) * (1 - smoothstep(120, 168, Math.abs(x - cx)))
  const armEnvelope = smoothstep(150, 188, y) * (1 - smoothstep(248, 292, y))
  const armL = smoothstep(92, 130, cx - x) * armEnvelope
  const armR = smoothstep(92, 130, x - cx) * armEnvelope
  const lower = smoothstep(400, 442, y)
  const shinL = lower * (1 - smoothstep(258, 300, x))
  const shinR = lower * smoothstep(258, 300, x)
  const limbSum = head + armL + armR + shinL + shinR
  const body = Math.max(0, 1 - limbSum)
  const chest = body * (1 - smoothstep(286, 352, y))
  const belly = body * smoothstep(272, 330, y) * (1 - smoothstep(404, 440, y))
  const hips = body * smoothstep(394, 436, y)
  return { head, chest, belly, hips, armL, armR, shinL, shinR }
}

export function meshNormaliseWeights(raw: Record<MeshWeightId, number>): Record<MeshWeightId, number> {
  let sum = 0
  for (const id of MESH_WEIGHT_IDS) sum += raw[id] || 0
  if (!(sum > 0) || !Number.isFinite(sum)) {
    const fallback = {} as Record<MeshWeightId, number>
    for (const id of MESH_WEIGHT_IDS) fallback[id] = id === 'hips' ? 1 : 0
    return fallback
  }
  const normalised = {} as Record<MeshWeightId, number>
  for (const id of MESH_WEIGHT_IDS) normalised[id] = (raw[id] || 0) / sum
  return normalised
}

/** 眨眼比例 0..1。cycleSeconds 可跟随桌宠设置。 */
export function meshBlinkAt(time: number, cycleSeconds = 4.8): number {
  const cycle = Math.max(2, cycleSeconds)
  const phase = ((time % cycle) + cycle) % cycle
  const start = cycle * 0.8125
  const close = 0.07
  const hold = 0.06
  const open = 0.08
  if (phase < start) return 0
  const x = phase - start
  if (x < close) return smoothstep(0, 1, x / close)
  if (x < close + hold) return 1
  if (x < close + hold + open) return 1 - smoothstep(0, 1, (x - close - hold) / open)
  return 0
}

/** 说话口型：返回源图坐标系下的半宽/半高与顶部固定后的中心偏移。 */
export function meshMouthShape(speech: number, time: number): { open: number; rx: number; ry: number; offsetY: number } {
  const level = clamp01(speech)
  const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((time * TAU) / 0.32))
  const open = level * pulse
  const rx = MESH_FACE.mouthRadius * (0.95 + 0.3 * open)
  const ry = MESH_FACE.mouthRadius * (0.55 + 1.5 * open)
  return { open, rx, ry, offsetY: ry - MESH_FACE.mouthRadius }
}

function damped(stateElapsed: number, rate: number): number {
  return Math.exp(-Math.max(0, stateElapsed) * rate)
}

/** 状态叠加：待机是基础，反应状态在基础之上加有衰减的偏移。 */
export function meshPoseAt(state: MeshPetState, time: number, stateElapsed: number, speech = 0): MeshPose {
  const breath = Math.sin((TAU * time) / 3.8)
  const sway = Math.sin((TAU * time) / 6.4)
  const sway2 = Math.sin((TAU * time) / 9.7 + 0.8)
  const talkBob = speech > 0 ? Math.sin((TAU * time) / 0.42) * 0.6 * speech : 0

  const pose: MeshPose = {
    headTiltDeg: 2.6 * Math.sin((TAU * time) / 4.9 + 0.4) + 1.0 * sway2,
    headNodDeg: 1.0 * breath + 0.4 * sway2 + talkBob,
    headTurn: 1.8 * Math.sin((TAU * time) / 5.7 + 1.2),
    headTurnScale: 1 + 0.004 * Math.sin((TAU * time) / 5.7 + 1.2),
    armLDeg: 5.2 * Math.sin((TAU * time) / 4.4 + 0.2) + 1.4 * sway,
    armRDeg: -4.6 * Math.sin((TAU * time) / 4.9 + 1.4) + 1.2 * sway,
    hipSway: 5.0 * sway,
    hipAngleDeg: 1.2 * sway,
    torsoAngleDeg: -0.8 * sway,
    chestLift: -1.2 * breath,
    chestScaleX: 1 + 0.012 * breath,
    chestScaleY: 1 + 0.007 * breath,
    bellyScaleX: 1 + 0.018 * breath,
    bellyScaleY: 1 - 0.006 * breath
  }

  switch (state) {
    case 'greet': {
      const envelope = smoothstep(0, 0.18, stateElapsed) * (1 - smoothstep(0.55, 1.3, stateElapsed))
      pose.armLDeg += 9 * Math.sin((TAU * stateElapsed) / 0.6) * envelope
      pose.armRDeg += -9 * Math.sin((TAU * stateElapsed) / 0.62 + 0.4) * envelope
      pose.chestLift += -3.2 * Math.sin((TAU * stateElapsed) / 0.6) * envelope
      pose.headNodDeg += 2.6 * Math.sin((TAU * stateElapsed) / 0.45) * envelope
      break
    }
    case 'think': {
      pose.headTiltDeg += 5.2
      pose.headTurn += 1.6
      pose.headNodDeg -= 1.2
      pose.armLDeg += 1.6
      pose.armRDeg -= 1.4
      break
    }
    case 'agree': {
      const decay = damped(stateElapsed, 1.6)
      pose.headNodDeg += 4.2 * Math.sin((TAU * stateElapsed) / 0.55) * decay
      break
    }
    case 'confused': {
      pose.headTiltDeg -= 3.4
      pose.headTurn += 2.6 * Math.sin((TAU * stateElapsed) / 0.7)
      break
    }
    case 'working': {
      pose.headNodDeg += 1.1 + 0.9 * Math.sin((TAU * stateElapsed) / 1.3)
      pose.bellyScaleX += 0.006 * Math.sin((TAU * stateElapsed) / 2.2)
      pose.armLDeg += 1.2 * Math.sin((TAU * stateElapsed) / 0.9)
      pose.armRDeg -= 1.2 * Math.sin((TAU * stateElapsed) / 0.95)
      break
    }
    case 'settle': {
      const decay = damped(stateElapsed, 3.2)
      pose.headTiltDeg += 2.4 * Math.sin((TAU * stateElapsed) / 0.5) * decay
      pose.hipSway += 2.2 * Math.sin((TAU * stateElapsed) / 0.42) * decay
      pose.armLDeg += 3 * decay
      pose.armRDeg -= 3 * decay
      break
    }
    default:
      break
  }
  return pose
}

const matIdentity = (): number[] => [1, 0, 0, 1, 0, 0]
const matTranslate = (tx: number, ty: number): number[] => [1, 0, 0, 1, tx, ty]
const matScaleAbout = (sx: number, sy: number, px: number, py: number): number[] => [sx, 0, 0, sy, px - sx * px, py - sy * py]
const matRotateAbout = (angle: number, px: number, py: number): number[] => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c, s, -s, c, px - c * px + s * py, py - s * px - c * py]
}
const matMultiply = (a: number[], b: number[]): number[] => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5]
]

export function meshBoneMatrices(pose: MeshPose, fit: MeshFit): MeshMatrices {
  const p = (x: number, y: number): [number, number] => meshToDisplay(fit, x, y)
  const hipPivot = p(278, 430)
  const torsoPivot = p(278, 380)
  const chestPivot = p(278, 262)
  const bellyPivot = p(278, 352)
  const headPivot = p(278, 214)
  const armLPivot = p(196, 248)
  const armRPivot = p(360, 248)

  const hips = matMultiply(matTranslate(pose.hipSway, 0), matRotateAbout(pose.hipAngleDeg * DEG, hipPivot[0], hipPivot[1]))
  const torso = matMultiply(hips, matRotateAbout(pose.torsoAngleDeg * DEG, torsoPivot[0], torsoPivot[1]))
  const chest = matMultiply(
    torso,
    matMultiply(matTranslate(0, pose.chestLift), matScaleAbout(pose.chestScaleX, pose.chestScaleY, chestPivot[0], chestPivot[1]))
  )
  const belly = matMultiply(torso, matScaleAbout(pose.bellyScaleX, pose.bellyScaleY, bellyPivot[0], bellyPivot[1]))
  const head = matMultiply(
    chest,
    matMultiply(
      matRotateAbout(pose.headTiltDeg * DEG, headPivot[0], headPivot[1]),
      matMultiply(
        matTranslate(0, pose.headNodDeg * fit.scale),
        matMultiply(
          matTranslate(pose.headTurn, 0),
          matScaleAbout(pose.headTurnScale, 1 - (pose.headTurnScale - 1) * 0.35, headPivot[0], headPivot[1])
        )
      )
    )
  )
  const armL = matMultiply(chest, matRotateAbout(pose.armLDeg * DEG, armLPivot[0], armLPivot[1]))
  const armR = matMultiply(chest, matRotateAbout(pose.armRDeg * DEG, armRPivot[0], armRPivot[1]))
  return { head, chest, belly, hips, torso, armL, armR, shinL: matIdentity(), shinR: matIdentity() }
}

export function applyMeshMatrix(matrix: number[], x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

/** 把静止顶点按权重与骨骼矩阵变形；rest 为显示坐标的扁平静止位置。 */
export function applyMeshPose(
  rest: Float64Array | Float32Array,
  weights: readonly Record<MeshWeightId, number>[],
  matrices: MeshMatrices,
  out: Float64Array
): Float64Array {
  const count = weights.length
  for (let vertex = 0; vertex < count; vertex += 1) {
    const w = weights[vertex]
    const x = rest[vertex * 2]
    const y = rest[vertex * 2 + 1]
    let outX = 0
    let outY = 0
    for (const id of MESH_WEIGHT_IDS) {
      const weight = w[id]
      if (!weight) continue
      const m = matrices[id]
      outX += weight * (m[0] * x + m[2] * y + m[4])
      outY += weight * (m[1] * x + m[3] * y + m[5])
    }
    out[vertex * 2] = outX
    out[vertex * 2 + 1] = outY
  }
  return out
}

/** 生成静止网格与 UV；uvScale 为贴图相对源图的倍率（2× 贴图时为 2）。 */
export function buildMesh(
  fit: MeshFit,
  uvScale = 1
): {
  rest: Float64Array
  uvs: Float32Array
  indices: Uint16Array
  weights: Array<Record<MeshWeightId, number>>
  vertices: number
  triangles: number
} {
  const vertices = (MESH_GRID.cols + 1) * (MESH_GRID.rows + 1)
  const triangles = MESH_GRID.cols * MESH_GRID.rows * 2
  const rest = new Float64Array(vertices * 2)
  const uvs = new Float32Array(vertices * 2)
  const indices = new Uint16Array(triangles * 3)
  const weights = new Array<Record<MeshWeightId, number>>(vertices)
  let vertex = 0
  for (let row = 0; row <= MESH_GRID.rows; row += 1) {
    const sy = MESH_CROP.y + (MESH_CROP.height * row) / MESH_GRID.rows
    for (let col = 0; col <= MESH_GRID.cols; col += 1) {
      const sx = MESH_CROP.x + (MESH_CROP.width * col) / MESH_GRID.cols
      const [dx, dy] = meshToDisplay(fit, sx, sy)
      rest[vertex * 2] = dx
      rest[vertex * 2 + 1] = dy
      uvs[vertex * 2] = ((sx + 0.5) * uvScale) / (MESH_SOURCE.width * uvScale)
      uvs[vertex * 2 + 1] = ((sy + 0.5) * uvScale) / (MESH_SOURCE.height * uvScale)
      weights[vertex] = meshNormaliseWeights(meshRawWeights(sx, sy))
      vertex += 1
    }
  }
  let cursor = 0
  for (let row = 0; row < MESH_GRID.rows; row += 1) {
    for (let col = 0; col < MESH_GRID.cols; col += 1) {
      const topLeft = row * (MESH_GRID.cols + 1) + col
      const topRight = topLeft + 1
      const bottomLeft = topLeft + MESH_GRID.cols + 1
      const bottomRight = bottomLeft + 1
      indices[cursor++] = topLeft
      indices[cursor++] = bottomLeft
      indices[cursor++] = topRight
      indices[cursor++] = topRight
      indices[cursor++] = bottomLeft
      indices[cursor++] = bottomRight
    }
  }
  return { rest, uvs, indices, weights, vertices, triangles }
}

/** 网格是否全部有限。 */
export function meshFinite(values: Float64Array | Float32Array): boolean {
  for (const value of values) if (!Number.isFinite(value)) return false
  return true
}
