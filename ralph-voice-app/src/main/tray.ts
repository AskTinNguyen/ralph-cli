import { Tray, Menu, nativeImage, app, NativeImage } from 'electron';
import { join } from 'path';
import { showWindow, hideWindow, getMainWindow } from './main';

let tray: Tray | null = null;

function createTrayIcon(): NativeImage {
  // In development, use a simple icon
  // In production, use the bundled icon from assets
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'assets', 'tray-icon.png')
    : join(__dirname, '../../assets/tray-icon.png');

  try {
    const icon = nativeImage.createFromPath(iconPath);
    // Resize for menu bar (16x16 or 18x18 for Retina)
    return icon.resize({ width: 18, height: 18 });
  } catch {
    // Fallback: create a simple colored icon
    return createFallbackIcon();
  }
}

function createFallbackIcon(): NativeImage {
  // Create a simple 18x18 icon with microphone-like appearance
  const size = 18;
  const canvas = Buffer.alloc(size * size * 4);

  // Fill with transparent background and a colored circle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - size / 2;
      const dy = y - size / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < size / 2 - 2) {
        // Blue color for the icon
        canvas[idx] = 66;     // R
        canvas[idx + 1] = 133; // G
        canvas[idx + 2] = 244; // B
        canvas[idx + 3] = 255; // A
      } else {
        // Transparent
        canvas[idx] = 0;
        canvas[idx + 1] = 0;
        canvas[idx + 2] = 0;
        canvas[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function buildContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Show Ralph Voice',
      click: () => showWindow()
    },
    {
      label: 'Hide Ralph Voice',
      click: () => hideWindow()
    },
    { type: 'separator' },
    {
      label: 'Preferences...',
      click: () => {
        // TODO: Open preferences window
        console.log('Preferences clicked');
      }
    },
    {
      label: 'Service Status',
      submenu: [
        {
          label: 'STT Service: Running',
          enabled: false
        },
        {
          label: 'Ollama: Connected',
          enabled: false
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'About Ralph Voice',
      role: 'about'
    },
    { type: 'separator' },
    {
      label: 'Quit Ralph Voice',
      accelerator: 'CommandOrControl+Q',
      click: () => app.quit()
    }
  ]);
}

export function createTray(): Tray {
  if (tray) {
    return tray;
  }

  const icon = createTrayIcon();
  tray = new Tray(icon);

  tray.setToolTip('Ralph Voice - Press ⌘⇧Space to activate');

  // Left click: show/hide window
  tray.on('click', () => {
    const mainWindow = getMainWindow();
    if (mainWindow?.isVisible()) {
      hideWindow();
    } else {
      showWindow();
    }
  });

  // Right click: show context menu
  tray.on('right-click', () => {
    const menu = buildContextMenu();
    tray?.popUpContextMenu(menu);
  });

  console.log('Tray created');
  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    console.log('Tray destroyed');
  }
}

export function updateTrayStatus(status: { stt: boolean; ollama: boolean }): void {
  // This could be called to update the tray menu with current service status
  console.log('Tray status updated:', status);
}
