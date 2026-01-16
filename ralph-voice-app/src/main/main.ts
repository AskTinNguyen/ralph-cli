import { app, BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { createTray, destroyTray } from './tray';
import { setupIpcHandlers } from './ipc-handlers';
import { STTService } from './stt-service';

let mainWindow: BrowserWindow | null = null;
let sttService: STTService | null = null;

function createWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const windowWidth = 400;
  const windowHeight = 300;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 3),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Hide from dock when window is hidden
  mainWindow.on('hide', () => {
    if (process.platform === 'darwin') {
      app.dock?.hide();
    }
  });

  mainWindow.on('show', () => {
    if (process.platform === 'darwin') {
      app.dock?.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('blur', () => {
    // Optional: hide window when it loses focus
    // mainWindow?.hide();
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function showWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }

  // Notify renderer to start recording
  mainWindow.webContents.send('start-recording');
}

export function hideWindow(): void {
  if (mainWindow && mainWindow.isVisible()) {
    // Notify renderer to stop recording
    mainWindow.webContents.send('stop-recording');
    mainWindow.hide();
  }
}

export function toggleWindow(): void {
  if (mainWindow?.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

async function initApp(): Promise<void> {
  // Create the window (hidden initially)
  createWindow();

  // Initialize STT service
  sttService = new STTService();
  await sttService.start();

  // Set up IPC handlers
  setupIpcHandlers(sttService);

  // Register global shortcuts
  registerShortcuts();

  // Create tray icon
  createTray();

  // Hide dock icon initially (macOS)
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  console.log('Ralph Voice initialized');
}

// App lifecycle events
app.whenReady().then(initApp);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  unregisterShortcuts();
  destroyTray();
  sttService?.stop();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      showWindow();
    }
  });
}
