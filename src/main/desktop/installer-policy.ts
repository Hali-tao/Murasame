export interface InstallerPolicy {
  executionLevel: 'asInvoker'
  perMachine: false
  deleteDataByDefault: false
  capabilities: string[]
}

export function installerPolicy(): InstallerPolicy {
  return {
    executionLevel: 'asInvoker',
    perMachine: false,
    deleteDataByDefault: false,
    capabilities: []
  }
}

export function uninstallChoice(deleteData: boolean): { keepUserData: boolean; note: string } {
  return deleteData
    ? { keepUserData: false, note: '将删除用户数据目录中的数据库、角色资源和日志。' }
    : { keepUserData: true, note: '默认保留本地数据。' }
}
