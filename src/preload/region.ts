import { contextBridge, ipcRenderer } from 'electron'
const channel = process.argv.find(value => value.startsWith('--region-channel='))?.slice('--region-channel='.length)
contextBridge.exposeInMainWorld('regionSelection', {
  complete: (rect: unknown) => { if (channel) ipcRenderer.send(channel, rect) }
})
