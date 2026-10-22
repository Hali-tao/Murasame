import { createHash } from 'node:crypto'

export interface SequenceNode {
  seqHash: string
  prevHash: string | null
  blobHash: string
}

export function annotateTruncation(value: string, limit = 4000): string {
  if (value.length <= limit) return value
  const omitted = value.length - limit
  return `${value.slice(0, limit)}…（省略 ${omitted} 个字符）`
}

export function addressSequence(messages: readonly string[]): { nodes: SequenceNode[]; blobs: Map<string, string> } {
  const blobs = new Map<string, string>()
  const nodes: SequenceNode[] = []
  let prev: string | null = null
  for (const message of messages) {
    const body = annotateTruncation(message)
    const blobHash = createHash('sha256').update(body).digest('hex')
    blobs.set(blobHash, body)
    const seqHash: string = createHash('sha256').update(`${prev ?? ''}|${blobHash}`).digest('hex')
    nodes.push({ seqHash, prevHash: prev, blobHash })
    prev = seqHash
  }
  return { nodes, blobs }
}
