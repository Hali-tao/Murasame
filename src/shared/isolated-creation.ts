export type CreationKind = 'office' | 'code'
export interface CreationDraft { title: string; content: string; expectedOutput: string }
export interface CreationArtifact {
  id: string
  kind: CreationKind
  title: string
  name: string
  sha256: string
  bytes: number
  preview: string
  stdout: string
  review: string
  attempt: number
}
export interface CreationProgress {
  phase: 'drafting' | 'executing' | 'reviewing' | 'ready' | 'failed'
  message: string
  artifact?: CreationArtifact
  saved?: { artifactId: string; path: string; bytes: number; sha256: string }
}
