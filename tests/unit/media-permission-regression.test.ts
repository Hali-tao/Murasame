import { describe, expect, it } from 'vitest'
import { allowMicrophone } from '../../src/main/security/media-permission'
describe('explicit microphone authorization', () => {
  const request = { permission: 'media', url: 'murasame://app/index.html', audioOnly: true, enabled: true }
  it('honors the user microphone switch for the trusted app', () => {
    expect(allowMicrophone(request)).toBe(true)
    expect(allowMicrophone({ ...request, enabled: false })).toBe(false)
  })
  it('does not grant camera, remote page or unrelated permissions', () => {
    expect(allowMicrophone({ ...request, audioOnly: false })).toBe(false)
    expect(allowMicrophone({ ...request, url: 'https://example.org' })).toBe(false)
    expect(allowMicrophone({ ...request, permission: 'display-capture' })).toBe(false)
    expect(allowMicrophone({ ...request, url: 'murasame://external/page' })).toBe(false)
  })
})
