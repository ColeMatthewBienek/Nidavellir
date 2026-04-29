import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import path from 'node:path';

app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Prevent multiple instances — second launch focuses the existing window and exits.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const IS_DEV = !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:5173';

ipcMain.handle('working-set:pick-files', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: 'Add Files',
    properties: ['openFile', 'multiSelections'],
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('workspace:pick-directory', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: 'Change Working Directory',
    properties: ['openDirectory'],
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('skills:pick-path', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: 'Import Skill',
    properties: ['openFile', 'openDirectory'],
    filters: [
      { name: 'Skill files', extensions: ['md', 'yaml', 'yml', 'zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('refs:open-code', async (_event, payload: { filePath: string; startLine?: number; endLine?: number }) => {
  const windowsPath = payload.filePath.replace(/^\/mnt\/([a-z])\/(.*)$/i, (_match, drive: string, rest: string) =>
    `${drive.toLowerCase()}:/${String(rest).replaceAll('\\', '/')}`
  );
  const suffix = payload.startLine ? `:${payload.startLine}` : '';
  await shell.openExternal(`vscode://file/${encodeURI(windowsPath)}${suffix}`);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (IS_DEV) {
    win.loadURL(VITE_DEV_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
}

// Focus the existing window when a second instance tries to open.
app.on('second-instance', () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const win = windows[0];
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
