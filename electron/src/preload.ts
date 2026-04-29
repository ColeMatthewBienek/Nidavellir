// Preload runs in renderer with Node integration disabled.
// Expose only explicitly whitelisted APIs via contextBridge.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nidavellir', {
  pickWorkingSetFiles: (): Promise<string[]> => ipcRenderer.invoke('working-set:pick-files'),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('workspace:pick-directory'),
  pickSkillPath: (): Promise<string | null> => ipcRenderer.invoke('skills:pick-path'),
  openCodeRef: (filePath: string, startLine?: number, endLine?: number): Promise<void> =>
    ipcRenderer.invoke('refs:open-code', { filePath, startLine, endLine }),
});
