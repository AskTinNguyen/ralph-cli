import { ipcMain, BrowserWindow } from 'electron';
import { STTService } from './stt-service';
import {
  createActionRouter,
  type ActionRouter,
  type PipelineResult,
  type VoiceIntent,
  type ExecutionResult,
} from '../voice-agent';

let actionRouter: ActionRouter | null = null;

/**
 * Set up IPC handlers for voice agent communication
 */
export function setupIpcHandlers(sttService: STTService): void {
  // Initialize the action router
  actionRouter = createActionRouter({
    sttServerUrl: `http://localhost:${sttService.getPort()}`,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:1.5b',
  });

  // Health check handler
  ipcMain.handle('voice:health', async () => {
    const sttHealth = await sttService.checkHealth();
    const services = actionRouter ? await actionRouter.checkServices() : null;

    return {
      stt: sttHealth,
      services,
      ready: sttHealth.healthy && services?.llm,
    };
  });

  // Transcribe audio handler
  ipcMain.handle('voice:transcribe', async (_event, audioData: ArrayBuffer) => {
    if (!actionRouter) {
      return { success: false, error: 'Voice agent not initialized' };
    }

    try {
      const buffer = Buffer.from(audioData);
      const result = await actionRouter['whisperClient'].transcribe(buffer);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Transcription failed',
      };
    }
  });

  // Classify intent handler
  ipcMain.handle('voice:classify', async (_event, text: string) => {
    if (!actionRouter) {
      return { success: false, error: 'Voice agent not initialized' };
    }

    try {
      const result = await actionRouter['intentClassifier'].classifyHybrid(text);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Classification failed',
      };
    }
  });

  // Process text (classify + optionally execute) handler
  ipcMain.handle('voice:process', async (_event, text: string, autoExecute: boolean = false) => {
    if (!actionRouter) {
      return { success: false, error: 'Voice agent not initialized' };
    }

    try {
      const result = await actionRouter.processText(text, { autoExecute });
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Processing failed',
      };
    }
  });

  // Execute intent handler
  ipcMain.handle('voice:execute', async (_event, intent: VoiceIntent) => {
    if (!actionRouter) {
      return { success: false, error: 'Voice agent not initialized' };
    }

    try {
      const result = await actionRouter.execute(intent);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed',
        action: intent.action,
        intent,
      };
    }
  });

  // Full pipeline handler (audio -> transcribe -> classify -> execute)
  ipcMain.handle('voice:pipeline', async (_event, audioData: ArrayBuffer, options: { autoExecute?: boolean } = {}) => {
    if (!actionRouter) {
      return { success: false, error: 'Voice agent not initialized', duration_ms: 0 };
    }

    try {
      const buffer = Buffer.from(audioData);
      const result = await actionRouter.processAudio(buffer, {
        autoExecute: options.autoExecute ?? true,
      });
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Pipeline failed',
        duration_ms: 0,
      };
    }
  });

  // TTS speak handler
  ipcMain.handle('voice:speak', async (_event, text: string) => {
    if (!actionRouter) {
      return { success: false, error: 'Voice agent not initialized' };
    }

    try {
      const result = await actionRouter.speak(text);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'TTS failed',
      };
    }
  });

  // TTS stop handler
  ipcMain.handle('voice:stop-tts', async () => {
    if (actionRouter) {
      actionRouter.stopTTS();
    }
    return { success: true };
  });

  // Get TTS voices handler
  ipcMain.handle('voice:get-voices', async () => {
    if (!actionRouter) {
      return [];
    }
    return actionRouter.getTTSVoices();
  });

  // Get conversation summary
  ipcMain.handle('voice:conversation-summary', async () => {
    if (!actionRouter) {
      return { turnCount: 0 };
    }
    return actionRouter.getConversationSummary();
  });

  // Clear conversation context
  ipcMain.handle('voice:clear-context', async () => {
    if (actionRouter) {
      actionRouter.clearConversationContext();
    }
    return { success: true };
  });

  // Get Ralph status
  ipcMain.handle('voice:ralph-status', async (_event, params: { prdNumber?: string; queryType?: string } = {}) => {
    if (!actionRouter) {
      return { success: false, error: 'Voice agent not initialized' };
    }
    return actionRouter.getStatus(params);
  });

  // Update configuration
  ipcMain.handle('voice:update-config', async (_event, config: { ollamaModel?: string; sttServerUrl?: string }) => {
    if (actionRouter) {
      actionRouter.updateConfig(config);
    }
    return { success: true };
  });

  // Enable/disable TTS
  ipcMain.handle('voice:set-tts-enabled', async (_event, enabled: boolean) => {
    if (actionRouter) {
      actionRouter.setTTSEnabled(enabled);
    }
    return { success: true };
  });

  // Check if TTS is enabled
  ipcMain.handle('voice:is-tts-enabled', async () => {
    if (!actionRouter) {
      return false;
    }
    return actionRouter.isTTSEnabled();
  });

  console.log('IPC handlers registered');
}

/**
 * Send event to renderer
 */
export function sendToRenderer(window: BrowserWindow | null, channel: string, data: unknown): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, data);
  }
}

/**
 * Clean up IPC handlers
 */
export function cleanupIpcHandlers(): void {
  ipcMain.removeHandler('voice:health');
  ipcMain.removeHandler('voice:transcribe');
  ipcMain.removeHandler('voice:classify');
  ipcMain.removeHandler('voice:process');
  ipcMain.removeHandler('voice:execute');
  ipcMain.removeHandler('voice:pipeline');
  ipcMain.removeHandler('voice:speak');
  ipcMain.removeHandler('voice:stop-tts');
  ipcMain.removeHandler('voice:get-voices');
  ipcMain.removeHandler('voice:conversation-summary');
  ipcMain.removeHandler('voice:clear-context');
  ipcMain.removeHandler('voice:ralph-status');
  ipcMain.removeHandler('voice:update-config');
  ipcMain.removeHandler('voice:set-tts-enabled');
  ipcMain.removeHandler('voice:is-tts-enabled');

  actionRouter = null;
  console.log('IPC handlers cleaned up');
}
