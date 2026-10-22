/// <reference types="vite/client" />

import type { MurasameApi } from '@shared/types'

declare global {
  interface Window {
    murasame: MurasameApi
  }
}

export {}
