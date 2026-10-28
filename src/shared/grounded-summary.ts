export const SUMMARY_LIMITS = { files: 5, fileBytes: 32 * 1024, totalBytes: 64 * 1024, sourceChars: 24000, draftChars: 12000, runMs: 120000, dispatches: 3 } as const
export interface GroundedSummaryWorkflow { kind: 'summarize-files'; sources: string[]; instruction: string; outputPath: string }
export interface SourceManifest { id: string; relativePath: string; bytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number; sha256?: string }
export interface SourceSnapshot extends SourceManifest { sha256: string; text: string; lines: string[] }
export interface GroundedDraft {
  title: string
  sections: Array<{ text: string; citations: Array<{ sourceId: string; fromLine: number; toLine: number; quote: string }> }>
  limitations: string[]
}
export interface GroundedCheckpoint {
  version: 1
  stage: 'awaiting-source-approval' | 'generating' | 'awaiting-write-approval' | 'writing' | 'verified'
  workflowHash: string
  sourceManifest: SourceManifest[]
  draft?: { markdown: string; sha256: string; citations: GroundedDraft['sections'] }
  modelSnapshotId: string
  dispatchCount: number
  traceId?: string
  outcomeKnown: boolean
}
