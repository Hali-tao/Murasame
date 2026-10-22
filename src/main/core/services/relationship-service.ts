export type RelationshipStage = '初识' | '熟悉' | '熟络' | '默契'

export interface RelationshipRecord {
  stage: RelationshipStage
  since: string
  days: number
  turns: number
  disclosed: number
  history: Array<{ stage: RelationshipStage; since: string }>
  lineId: string
}

const order: RelationshipStage[] = ['初识', '熟悉', '熟络', '默契']

const address: Record<RelationshipStage, { title: string; tone: string; joke: string }> = {
  初识: { title: '你', tone: '把话说完整', joke: '不开玩笑' },
  熟悉: { title: '你', tone: '可以短一些', joke: '只在你先开玩笑时接一句' },
  熟络: { title: '称呼可以更自然', tone: '语气可以松一点', joke: '可以开无伤大雅的玩笑' },
  默契: { title: '沿用你喜欢的称呼', tone: '像熟人一样说', joke: '玩笑仍不能改变事实' }
}

export function blankRelationship(now = new Date().toISOString()): RelationshipRecord {
  return { stage: '初识', since: now, days: 0, turns: 0, disclosed: 0, history: [{ stage: '初识', since: now }], lineId: 'line-1' }
}

export function advanceRelationship(record: RelationshipRecord, now = new Date().toISOString()): RelationshipRecord {
  const score = record.days + Math.floor(record.turns / 20) + record.disclosed
  const next: RelationshipStage = score >= 40 ? '默契' : score >= 20 ? '熟络' : score >= 8 ? '熟悉' : '初识'
  if (next === record.stage) return record
  return { ...record, stage: next, since: now, history: [...record.history, { stage: next, since: now }] }
}

export function resetRelationship(record: RelationshipRecord, now = new Date().toISOString()): RelationshipRecord {
  return { ...blankRelationship(now), lineId: record.lineId, history: [...record.history, { stage: '初识', since: now }] }
}

export function startNewLine(record: RelationshipRecord, now = new Date().toISOString()): RelationshipRecord {
  return { ...blankRelationship(now), lineId: `line-${record.history.length + 1}` }
}

export function relationshipVoice(stage: RelationshipStage): { title: string; tone: string; joke: string } {
  return address[stage]
}

export function stageIndex(stage: RelationshipStage): number {
  return order.indexOf(stage)
}

export function honestFailure(style: string, failed: boolean): string {
  const warm = /夸|热情|活泼/.test(style)
  if (!failed) return warm ? '这次做成了。' : '已完成。'
  return warm ? '这次没做成。失败原因需要照实说，不能把它说成已经完成。' : '这次失败了。'
}
