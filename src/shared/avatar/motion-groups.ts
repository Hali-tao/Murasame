/** Resolve against the loaded asset, including imports which need not share preset names. */
export function resolveMotionGroup(requested: string, available: readonly string[], fallbacks: readonly string[] = []): string | null {
  for (const name of [requested, ...fallbacks]) {
    if (available.includes(name)) return name
    const match = available.find(group => group.toLowerCase() === name.toLowerCase())
    if (match) return match
  }
  return available[0] ?? null
}
