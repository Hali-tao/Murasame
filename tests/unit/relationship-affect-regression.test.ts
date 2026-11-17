// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CharacterPage } from '../../src/renderer/src/pages/CharacterPage'
import { useAppStore, resetStoreForTests } from '../../src/renderer/src/store'
import { initialBootstrap } from '../../src/shared/mock-data'
import { PET_PRESETS } from '../../src/shared/pet-presets'
import type { AppSettings, MurasameApi, RelationshipView } from '../../src/shared/types'
import { AffectService } from '../../src/main/core/services/affect-service'
import { baselinePad } from '../../src/shared/avatar/pad'
import { blankRelationship, startNewLine, resetRelationship } from '../../src/main/core/services/relationship-service'

let relation: RelationshipView
let api: MurasameApi
beforeEach(() => {
  resetStoreForTests()
  const data = initialBootstrap()
  data.settings.petPreset = PET_PRESETS[0].id
  useAppStore.setState({ data, loading: false })
  relation = { stage: '熟悉', since: '2026-10-20T12:00:00Z', history: [{ stage: '初识', since: '2026-10-01T12:00:00Z' }, { stage: '熟悉', since: '2026-10-20T12:00:00Z' }], lineId: 'line-original', address: '你' }
  api = { relationship: {
    get: async () => relation,
    reset: vi.fn(async () => { relation = { ...relation, stage: '初识', history: [...relation.history, { stage: '初识', since: '2026-10-28T12:00:00Z' }] }; return relation }),
    changeAppearance: vi.fn(async ({ patch, mode }: { patch: Partial<AppSettings>; mode: 'continue' | 'new' }) => {
      if (mode === 'new') relation = { ...relation, stage: '初识', lineId: 'line-new' }
      return { settings: { ...useAppStore.getState().data!.settings, ...patch }, relationship: relation }
    })
  } } as unknown as MurasameApi
  Object.defineProperty(window, 'murasame', { configurable: true, value: api })
})
afterEach(cleanup)

describe('relationship management with explicit appearance choice', () => {
  it('names the two appearances distinctly and does not mark a preset active for an imported model', async () => {
    useAppStore.setState(state => ({ data: { ...state.data!, settings: { ...state.data!.settings, importedModelUrl: 'custom/model.model3.json', importedCharacterName: '自定义伙伴' } } }))
    render(createElement(CharacterPage))
    await screen.findByText('熟悉')
    expect(screen.getByTestId('pet-preset-naiwa').textContent).toContain('奶娃')
    expect(screen.getByTestId('pet-preset-nailong').textContent).toContain('奶龙')
    for (const preset of PET_PRESETS) expect(screen.getByTestId(`pet-preset-${preset.id}`).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('当前外观：自定义伙伴')).toBeTruthy()
  })

  it('invalidates an imported resource when its selected path changes', async () => {
    api.character = { importAsset: vi.fn(async () => ({ ok: true, data: { modelUrl: 'custom/model.model3.json' } })) } as unknown as MurasameApi['character']
    render(createElement(CharacterPage))
    await screen.findByText('熟悉')
    const path = screen.getByPlaceholderText('用下面的按钮选择目录或 zip')
    fireEvent.change(path, { target: { value: 'C:/first.zip' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '校验并导入' })) })
    expect((screen.getByRole('button', { name: '使用该形象' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(path, { target: { value: 'C:/second.zip' } })
    expect((screen.getByRole('button', { name: '使用该形象' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.relationship.changeAppearance).not.toHaveBeenCalled()
  })

  it('shows current stage, evolution history and a reset that keeps history', async () => {
    render(createElement(CharacterPage))
    await screen.findByText('熟悉')
    expect(screen.getByText('2026/10/20')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重置关系' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
    await vi.waitFor(() => expect(api.relationship.reset).toHaveBeenCalledTimes(1))
    expect(relation.history).toHaveLength(3)
    expect(screen.getAllByText('初识').length).toBeGreaterThan(0)
  })

  it('requires an explicit relationship choice before switching appearance and preserves saved memories', async () => {
    render(createElement(CharacterPage))
    const originalMemories = structuredClone(useAppStore.getState().data!.memories)
    fireEvent.click(screen.getByTestId(`pet-preset-${PET_PRESETS[1].id}`))
    expect(api.relationship.changeAppearance).not.toHaveBeenCalled()
    expect(screen.getByLabelText('只更换外观，保留熟悉程度')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('更换外观，熟悉程度从初识开始'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认更换' })))
    expect(api.relationship.changeAppearance).toHaveBeenCalledWith(expect.objectContaining({ mode: 'new', patch: expect.objectContaining({ petPreset: PET_PRESETS[1].id }) }))
    expect(useAppStore.getState().data?.settings.petPreset).toBe(PET_PRESETS[1].id)
    expect(useAppStore.getState().data?.memories).toEqual(originalMemories)
    expect(relation.lineId).toBe('line-new')
  })

  it('archives earlier relationship lines and reset keeps the archive', () => {
    const original = { ...blankRelationship('2026-01-01'), stage: '熟悉' as const, history: [{ stage: '初识' as const, since: '2026-01-01' }, { stage: '熟悉' as const, since: '2026-02-01' }] }
    const next = startNewLine(original, '2026-03-01')
    expect(next.archivedLines?.[0].lineId).toBe(original.lineId)
    expect(next.archivedLines?.[0].history).toHaveLength(2)
    expect(next.lineId).not.toBe(original.lineId)
    expect(resetRelationship(next, '2026-04-01').archivedLines).toEqual(next.archivedLines)
  })
})

describe('short term affect decays with elapsed time and restarts at baseline', () => {
  it('returns toward baseline while idle without requiring another event', () => {
    let now = 0
    const affect = new AffectService(() => now)
    affect.apply({ relevance: 1, consequence: 1, coping: 1, norm: 0 })
    const immediate = affect.pad
    now += 10 * 60_000
    const later = affect.pad
    expect(Math.abs(later.pleasure)).toBeLessThan(Math.abs(immediate.pleasure))
    expect(Math.abs(later.arousal - 0.2)).toBeLessThan(Math.abs(immediate.arousal - 0.2))
    expect(Math.abs(later.dominance)).toBeLessThan(Math.abs(immediate.dominance))
    now += 24 * 60 * 60_000
    expect(affect.pad.pleasure).toBeCloseTo(0, 5)
    expect(affect.pad.arousal).toBeCloseTo(0.2, 5)
    expect(affect.pad.dominance).toBeCloseTo(0, 5)
    expect(new AffectService(() => now).pad).toEqual(baselinePad())
  })
})
