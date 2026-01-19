import { contextBridge, ipcRenderer } from 'electron';

/**
 * Voice API exposed to renderer process
 */
const voiceAPI = {
  /**
   * Check health of voice services
   */
  checkHealth: (): Promise<{
    stt: { healthy: boolean; model?: string; error?: string };
    services: {
      stt: boolean;
      llm: boolean;
      appleScript: boolean;
      ralph: boolean;
      claudeCode: boolean;
      tts: boolean;
      openInterpreter: boolean;
      messages: string[];
    } | null;
    ready: boolean;
  }> => ipcRenderer.invoke('voice:health'),

  /**
   * Transcribe audio data to text
   */
  transcribe: (audioData: ArrayBuffer): Promise<{
    success: boolean;
    text?: string;
    language?: string;
    duration_ms?: number;
    error?: string;
  }> => ipcRenderer.invoke('voice:transcribe', audioData),

  /**
   * Classify intent from text
   */
  classify: (text: string): Promise<{
    success: boolean;
    intent?: {
      action: string;
      command?: string;
      target?: string;
      parameters?: Record<string, string>;
      confidence: number;
      originalText?: string;
      requiresConfirmation?: boolean;
    };
    raw?: string;
    error?: string;
    duration_ms?: number;
  }> => ipcRenderer.invoke('voice:classify', text),

  /**
   * Process text (classify + optionally execute)
   */
  process: (text: string, autoExecute?: boolean): Promise<{
    success: boolean;
    intent?: {
      action: string;
      command?: string;
      target?: string;
      parameters?: Record<string, string>;
      confidence: number;
    };
    execution?: {
      success: boolean;
      output?: string;
      error?: string;
    };
    error?: string;
    duration_ms: number;
  }> => ipcRenderer.invoke('voice:process', text, autoExecute ?? false),

  /**
   * Execute an intent
   */
  execute: (intent: {
    action: string;
    command?: string;
    target?: string;
    parameters?: Record<string, string>;
    confidence: number;
    originalText?: string;
    requiresConfirmation?: boolean;
  }): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    exitCode?: number;
    duration_ms?: number;
  }> => ipcRenderer.invoke('voice:execute', intent),

  /**
   * Full pipeline: audio -> transcribe -> classify -> execute
   */
  pipeline: (audioData: ArrayBuffer, options?: { autoExecute?: boolean }): Promise<{
    success: boolean;
    transcription?: { success: boolean; text?: string };
    intent?: { action: string; command?: string; confidence: number };
    execution?: { success: boolean; output?: string; filteredOutput?: string; error?: string };
    error?: string;
    failedStage?: string;
    duration_ms: number;
  }> => ipcRenderer.invoke('voice:pipeline', audioData, options ?? {}),

  /**
   * Speak text via TTS
   */
  speak: (text: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('voice:speak', text),

  /**
   * Stop TTS playback
   */
  stopTTS: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('voice:stop-tts'),

  /**
   * Get available TTS voices
   */
  getVoices: (): Promise<string[]> =>
    ipcRenderer.invoke('voice:get-voices'),

  /**
   * Get detailed TTS voice information
   */
  getVoiceDetails: (): Promise<Array<{
    id: string;
    filename: string;
    language: string;
    name: string;
    quality: string;
    installed: boolean;
  }>> => ipcRenderer.invoke('voice:get-voice-details'),

  /**
   * Set the active TTS voice
   */
  setVoice: (voice: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('voice:set-voice', voice),

  /**
   * Get the current TTS voice
   */
  getCurrentVoice: (): Promise<string> =>
    ipcRenderer.invoke('voice:get-current-voice'),

  /**
   * Get conversation summary
   */
  getConversationSummary: (): Promise<{
    turnCount: number;
    currentPrd?: string;
    lastCommand?: string;
  }> => ipcRenderer.invoke('voice:conversation-summary'),

  /**
   * Clear conversation context
   */
  clearContext: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('voice:clear-context'),

  /**
   * Get Ralph status
   */
  getRalphStatus: (params?: { prdNumber?: string; queryType?: string }): Promise<{
    success: boolean;
    summary?: string;
    error?: string;
  }> => ipcRenderer.invoke('voice:ralph-status', params ?? {}),

  /**
   * Update configuration
   */
  updateConfig: (config: { ollamaModel?: string; sttServerUrl?: string }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('voice:update-config', config),

  /**
   * Set TTS enabled state
   */
  setTTSEnabled: (enabled: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('voice:set-tts-enabled', enabled),

  /**
   * Check if TTS is enabled
   */
  isTTSEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('voice:is-tts-enabled'),

  /**
   * Listen for start-recording event from main process
   */
  onStartRecording: (callback: () => void) => {
    ipcRenderer.on('start-recording', callback);
    return () => ipcRenderer.removeListener('start-recording', callback);
  },

  /**
   * Listen for stop-recording event from main process
   */
  onStopRecording: (callback: () => void) => {
    ipcRenderer.on('stop-recording', callback);
    return () => ipcRenderer.removeListener('stop-recording', callback);
  },
};

/**
 * Window API exposed to renderer process
 */
const windowAPI = {
  /**
   * Request to close the window
   */
  close: () => ipcRenderer.send('window:close'),

  /**
   * Request to minimize the window
   */
  minimize: () => ipcRenderer.send('window:minimize'),

  /**
   * Check if the window is focused
   */
  isFocused: (): Promise<boolean> => ipcRenderer.invoke('window:is-focused'),
};

// Expose APIs to renderer process
contextBridge.exposeInMainWorld('voiceAPI', voiceAPI);
contextBridge.exposeInMainWorld('windowAPI', windowAPI);

// Type declarations for renderer
declare global {
  interface Window {
    voiceAPI: typeof voiceAPI;
    windowAPI: typeof windowAPI;
  }
}
