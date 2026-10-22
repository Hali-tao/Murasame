import type { Verdict } from '@shared/evidence'
import { statusPresentation, verdictPresentation, type RuntimeStatus } from '../lib/status'
import { Pill } from './ui'

export function StatusPill({ status }: { status: RuntimeStatus }): React.JSX.Element {
  const view = statusPresentation[status]
  return <Pill tone={view.tone} className={view.motion === 'pulse' ? 'is-pulsing' : undefined}>{view.label}</Pill>
}

export function VerdictPill({ verdict }: { verdict: Verdict }): React.JSX.Element {
  const view = verdictPresentation[verdict]
  return <Pill tone={view.tone}>{view.label}</Pill>
}
