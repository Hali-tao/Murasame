export const IPC = {
  app: {
    getInfo: 'app:get-info',
    quit: 'app:quit',
    hideToTray: 'app:hide-to-tray',
    openLogs: 'app:open-logs',
    openUserData: 'app:open-user-data',
    clearLogs: 'app:clear-logs'
  },
  window: {
    showMain: 'window:show-main',
    hideMain: 'window:hide-main',
    minimize: 'window:minimize'
  },
  pet: {
    show: 'pet:show',
    hide: 'pet:hide',
    toggle: 'pet:toggle',
    getState: 'pet:get-state',
    setScale: 'pet:set-scale',
    setPosition: 'pet:set-position',
    setIgnoreMouseEvents: 'pet:set-ignore-mouse-events',
    getBounds: 'pet:get-bounds',
    resetPosition: 'pet:reset-position',
    stateChanged: 'pet:state-changed'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    changed: 'settings:changed'
  },
  updates: {
    check: 'updates:check'
  },
  core: {
    getBootstrap: 'core:get-bootstrap',
    createConversation: 'core:create-conversation',
    sendMessage: 'core:send-message',
    messageDelta: 'core:message-delta',
    deleteConversation: 'core:delete-conversation',
    addMemory: 'core:add-memory',
    updateMemory: 'core:update-memory',
    deleteMemory: 'core:delete-memory',
    clearMemories: 'core:clear-memories',
    createTask: 'core:create-task',
    approveTask: 'core:approve-task',
    cancelTask: 'core:cancel-task',
    setToolEnabled: 'core:set-tool-enabled',
    verifyModel: 'core:verify-model',
    createModel: 'core:create-model',
    saveModel: 'core:save-model',
    setDefaultModel: 'core:set-default-model',
    saveCharacter: 'core:save-character',
    analyzeScreen: 'core:analyze-screen'
  }
} as const

export type IpcChannels = typeof IPC
