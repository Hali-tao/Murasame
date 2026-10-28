export const IPC = {
  app: {
    getInfo: 'app:get-info',
    quit: 'app:quit',
    hideToTray: 'app:hide-to-tray',
    openLogs: 'app:open-logs',
    openUserData: 'app:open-user-data',
    clearLogs: 'app:clear-logs',
    pickOpen: 'app:pick-open',
    pickSave: 'app:pick-save',
    hotkey: 'app:hotkey'
  },
  window: {
    showMain: 'window:show-main',
    hideMain: 'window:hide-main',
    minimize: 'window:minimize',
    openPath: 'window:open-path',
    navigated: 'window:navigated',
    hidden: 'window:hidden'
  },
  pet: {
    show: 'pet:show',
    hide: 'pet:hide',
    toggle: 'pet:toggle',
    getState: 'pet:get-state',
    getAffect: 'pet:get-affect',
    setScale: 'pet:set-scale',
    setPosition: 'pet:set-position',
    setIgnoreMouseEvents: 'pet:set-ignore-mouse-events',
    getBounds: 'pet:get-bounds',
    resetPosition: 'pet:reset-position',
    setChatOpen: 'pet:set-chat-open',
    beginDrag: 'pet:begin-drag',
    dragMove: 'pet:drag-move',
    endDrag: 'pet:end-drag',
    focusChat: 'pet:focus-chat',
    performance: 'pet:performance',
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
    setActiveConversation: 'core:set-active-conversation',
    messageDelta: 'core:message-delta',
    messageStarted: 'core:message-started',
    messageFailed: 'core:message-failed',
    conversationUpdated: 'core:conversation-updated',
    taskUpdated: 'core:task-updated',
    screenUpdated: 'core:screen-updated',
    memoriesUpdated: 'core:memories-updated',
    memoryExtractionStatus: 'core:memory-extraction-status',
    activeChanged: 'core:active-changed',
    deleteConversation: 'core:delete-conversation',
    addMemory: 'core:add-memory',
    updateMemory: 'core:update-memory',
    deleteMemory: 'core:delete-memory',
    clearMemories: 'core:clear-memories',
    createTask: 'core:create-task',
    approveTask: 'core:approve-task',
    continueTask: 'core:continue-task',
    openArtifact: 'core:open-artifact',
    cancelTask: 'core:cancel-task',
    setToolEnabled: 'core:set-tool-enabled',
    verifyModel: 'core:verify-model',
    createModel: 'core:create-model',
    saveModel: 'core:save-model',
    deleteModel: 'core:delete-model',
    setDefaultModel: 'core:set-default-model',
    saveCharacter: 'core:save-character',
    analyzeScreen: 'core:analyze-screen',
    searchHistory: 'core:search-history',
    denyTask: 'core:deny-task'
  },
  screen: {
    capture: 'screen:capture',
    watchStart: 'screen:watch-start',
    watchStop: 'screen:watch-stop'
  },
  voice: {
    start: 'voice:start',
    stop: 'voice:stop',
    transcribe: 'voice:transcribe',
    speak: 'voice:speak',
    readiness: 'voice:readiness'
  },
  autonomy: {
    environment: 'autonomy:environment',
    start: 'autonomy:start',
    open: 'autonomy:open',
    look: 'autonomy:look',
    browse: 'autonomy:browse',
    watch: 'autonomy:watch',
    buildImage: 'autonomy:build-image',
    buildProgress: 'autonomy:build-progress',
    stop: 'autonomy:stop',
    status: 'autonomy:status'
  },
  character: {
    importAsset: 'character:import-asset'
  },
  relationship: {
    get: 'relationship:get',
    reset: 'relationship:reset',
    changeAppearance: 'relationship:change-appearance',
    changed: 'relationship:changed'
  },
  data: {
    exportBundle: 'data:export-bundle',
    importBundle: 'data:import-bundle'
  },
  task: {
    progress: 'task:progress'
  }
} as const

export type IpcChannels = typeof IPC
