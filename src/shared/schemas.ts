import { z } from 'zod'
import { PET_PRESET_IDS } from './pet-presets'

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().min(1).max(8000)
})

export const deleteConversationSchema = z.object({
  id: z.string().min(1),
  scopes: z.array(z.enum(['history', 'memory', 'cache', 'logs'])).min(1)
})

export const memoryAddSchema = z.object({
  category: z.string().trim().min(1).max(30),
  text: z.string().trim().min(1).max(1000)
})

export const memoryUpdateSchema = memoryAddSchema.extend({
  id: z.string().min(1)
})

export const memoryDeleteSchema = z.object({ id: z.string().min(1) })

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(120)
})

export const idSchema = z.object({ id: z.string().min(1) })

export const toolToggleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean()
})

export const modelInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(60),
  endpoint: z.string().trim().max(500).url(),
  key: z.string().max(500),
  model: z.string().trim().min(1).max(200),
  caps: z.array(z.string().min(1).max(30)).max(10)
})

export const modelSaveSchema = z.object({
  id: z.string().min(1),
  input: modelInputSchema
})

export const modelVerifySchema = z.object({
  id: z.string().min(1),
  input: modelInputSchema.optional()
})

export const characterSchema = z.object({
  name: z.string().trim().min(1).max(40),
  style: z.string().trim().min(1).max(80),
  example: z.string().max(2000),
  keywords: z.array(z.string().min(1).max(30)).max(12),
  proactive: z.boolean(),
  memory: z.boolean()
})

export const settingsPatchSchema = z.object({
  startAtLogin: z.boolean().optional(),
  minimizeToTray: z.boolean().optional(),
  doNotDisturb: z.boolean().optional(),
  taskNotifications: z.boolean().optional(),
  encryptLocalData: z.boolean().optional(),
  closeBehavior: z.enum(['tray', 'ask', 'quit']).optional(),
  logRetentionDays: z.number().int().min(1).max(365).optional(),
  memoryEnabled: z.boolean().optional(),
  memoryAutoExtract: z.boolean().optional(),
  petVisible: z.boolean().optional(),
  petScale: z.number().min(0.6).max(1.4).optional(),
  petPreset: z.enum(PET_PRESET_IDS).optional(),
  importedModelUrl: z.string().max(500).optional(),
  importedCharacterName: z.string().max(80).optional(),
  screenWatchEnabled: z.boolean().optional(),
  screenWatchSeconds: z.union([z.literal(5), z.literal(15), z.literal(60)]).optional(),
  voiceRoute: z.enum(['local', 'windows', 'cloud']).optional(),
  speakReplies: z.boolean().optional(),
  userName: z.string().max(40).optional(),
  outboundImages: z.boolean().optional(),
  petHotkey: z.string().trim().min(1).max(40).optional(),
  proactivePace: z.enum(['low', 'mid', 'high']).optional(),
  onboardingDone: z.boolean().optional(),
  permissions: z
    .object({
      screen: z.boolean().optional(),
      microphone: z.boolean().optional(),
      accessibility: z.boolean().optional()
    })
    .optional()
})

export const petScaleSchema = z.object({ scale: z.number().min(0.6).max(1.4) })
export const petPositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int()
})
export const ignoreMouseSchema = z.object({ ignore: z.boolean() })
export const petChatSchema = z.object({ open: z.boolean() })

export const screenCaptureSchema = z.object({ continuous: z.boolean().optional() })
export const voiceControlSchema = z.object({ enabled: z.boolean() })
export const autonomyControlSchema = z.object({
  scope: z.string().trim().max(500).optional()
})
export const characterImportSchema = z.object({
  path: z.string().trim().min(1).max(1000)
})
export const taskProgressSchema = z.object({ id: z.string().min(1) })
