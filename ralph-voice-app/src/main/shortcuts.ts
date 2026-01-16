import { globalShortcut, app } from 'electron';
import { showWindow, hideWindow, toggleWindow, getMainWindow } from './main';

const SHORTCUTS = {
  TOGGLE: 'CommandOrControl+Shift+Space',
  CANCEL: 'Escape'
};

export function registerShortcuts(): void {
  // Main activation shortcut: Cmd+Shift+Space
  const toggleRegistered = globalShortcut.register(SHORTCUTS.TOGGLE, () => {
    console.log('Toggle shortcut pressed');
    toggleWindow();
  });

  if (!toggleRegistered) {
    console.error('Failed to register toggle shortcut:', SHORTCUTS.TOGGLE);
  } else {
    console.log('Registered shortcut:', SHORTCUTS.TOGGLE);
  }

  // Escape to cancel and hide
  // Note: Escape is handled differently - we register it only when window is visible
  // because it's a common key that shouldn't be globally captured

  // Instead of global Escape, we'll handle it in the renderer via IPC
  console.log('Shortcuts registered');
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
  console.log('Shortcuts unregistered');
}

export function registerEscapeShortcut(): void {
  if (!globalShortcut.isRegistered(SHORTCUTS.CANCEL)) {
    globalShortcut.register(SHORTCUTS.CANCEL, () => {
      console.log('Escape pressed - hiding window');
      const mainWindow = getMainWindow();
      if (mainWindow?.isVisible()) {
        hideWindow();
      }
    });
  }
}

export function unregisterEscapeShortcut(): void {
  if (globalShortcut.isRegistered(SHORTCUTS.CANCEL)) {
    globalShortcut.unregister(SHORTCUTS.CANCEL);
  }
}
