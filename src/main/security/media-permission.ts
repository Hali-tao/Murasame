export function allowMicrophone(input: { permission: string; url: string; audioOnly: boolean; enabled: boolean; developmentOrigin?: string }): boolean {
  if (input.permission !== 'media' || !input.audioOnly || !input.enabled) return false
  try {
    const url = new URL(input.url)
    if (url.protocol === 'murasame:' && url.hostname === 'app') return true
    return Boolean(input.developmentOrigin && url.origin === new URL(input.developmentOrigin).origin)
  } catch { return false }
}
