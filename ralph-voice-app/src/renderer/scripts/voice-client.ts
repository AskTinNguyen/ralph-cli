/**
 * Ralph Voice - Renderer Client
 *
 * Handles UI interactions, audio recording, and IPC communication
 * with the main process voice agent.
 */

// State
let isRecording = false;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioStream: MediaStream | null = null;

// TTS State
let ttsEnabled = true;
let ttsSpeaking = false;
let showFilteredOutput = true;

// DOM Elements
const micButton = document.getElementById('micButton') as HTMLButtonElement;
const statusDot = document.querySelector('.status-dot') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const sttBadge = document.getElementById('sttBadge') as HTMLElement;
const llmBadge = document.getElementById('llmBadge') as HTMLElement;
const ttsBadge = document.getElementById('ttsBadge') as HTMLElement;
const waveform = document.getElementById('waveform') as HTMLElement;
const transcriptionArea = document.getElementById('transcriptionArea') as HTMLElement;
const transcriptionText = document.getElementById('transcriptionText') as HTMLElement;
const intentArea = document.getElementById('intentArea') as HTMLElement;
const intentBadge = document.getElementById('intentBadge') as HTMLElement;
const intentCommand = document.getElementById('intentCommand') as HTMLElement;
const outputArea = document.getElementById('outputArea') as HTMLElement;
const outputText = document.getElementById('outputText') as HTMLElement;
const errorArea = document.getElementById('errorArea') as HTMLElement;
const errorText = document.getElementById('errorText') as HTMLElement;
const copyButton = document.getElementById('copyButton') as HTMLButtonElement;

// TTS DOM Elements
const ttsEnabledCheckbox = document.getElementById('ttsEnabled') as HTMLInputElement;
const ttsStopBtn = document.getElementById('ttsStopBtn') as HTMLButtonElement;
const ttsStatusEl = document.getElementById('ttsStatus') as HTMLElement;
const voiceSelect = document.getElementById('voiceSelect') as HTMLSelectElement;
const outputToggle = document.getElementById('outputToggle') as HTMLElement;
const toggleFilteredBtn = document.getElementById('toggleFiltered') as HTMLButtonElement;
const toggleFullBtn = document.getElementById('toggleFull') as HTMLButtonElement;
const filteredOutputEl = document.getElementById('filteredOutput') as HTMLElement;

/**
 * Initialize the voice client
 */
async function init(): Promise<void> {
  // Check services health
  await checkHealth();

  // Load available voices
  await loadVoices();

  // Set up event listeners
  micButton.addEventListener('click', toggleRecording);
  copyButton?.addEventListener('click', copyOutput);

  // Set up TTS event listeners
  ttsEnabledCheckbox?.addEventListener('change', handleTTSToggle);
  ttsStopBtn?.addEventListener('click', stopTTS);
  voiceSelect?.addEventListener('change', handleVoiceChange);
  toggleFilteredBtn?.addEventListener('click', () => setOutputView('filtered'));
  toggleFullBtn?.addEventListener('click', () => setOutputView('full'));

  // Listen for IPC events from main process
  window.voiceAPI.onStartRecording(() => {
    if (!isRecording) {
      startRecording();
    }
  });

  window.voiceAPI.onStopRecording(() => {
    if (isRecording) {
      stopRecording();
    }
  });

  // Set up keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);

  console.log('Voice client initialized');
}

/**
 * Check services health
 */
async function checkHealth(): Promise<void> {
  try {
    const health = await window.voiceAPI.checkHealth();

    // Update STT badge
    if (health.stt?.healthy) {
      sttBadge.classList.add('active');
      sttBadge.classList.remove('inactive');
    } else {
      sttBadge.classList.add('inactive');
      sttBadge.classList.remove('active');
    }

    // Update LLM badge
    if (health.services?.llm) {
      llmBadge.classList.add('active');
      llmBadge.classList.remove('inactive');
    } else {
      llmBadge.classList.add('inactive');
      llmBadge.classList.remove('active');
    }

    // Update TTS badge
    if (health.services?.tts) {
      ttsBadge?.classList.add('active');
      ttsBadge?.classList.remove('inactive');
      ttsEnabled = true;
      if (ttsEnabledCheckbox) ttsEnabledCheckbox.checked = true;
    } else {
      ttsBadge?.classList.add('inactive');
      ttsBadge?.classList.remove('active');
    }

    // Update status
    if (health.ready) {
      setStatus('ready', 'Ready');
    } else {
      setStatus('error', 'Services unavailable');
      showError('Some services are not available. Check STT server and Ollama.');
    }
  } catch (error) {
    setStatus('error', 'Connection error');
    showError('Failed to connect to voice services');
  }
}

/**
 * Toggle recording state
 */
function toggleRecording(): void {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

/**
 * Start recording audio
 */
async function startRecording(): Promise<void> {
  try {
    // Request microphone access
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });

    // Create media recorder
    mediaRecorder = new MediaRecorder(audioStream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      await processRecording();
    };

    // Start recording
    mediaRecorder.start();
    isRecording = true;

    // Update UI
    micButton.classList.add('recording');
    waveform.classList.add('active');
    setStatus('listening', 'Listening...');
    hideError();
    hideIntent();
    hideOutput();
    transcriptionText.textContent = 'Listening...';
    transcriptionText.classList.add('active');

  } catch (error) {
    console.error('Failed to start recording:', error);
    showError('Microphone access denied. Please allow microphone access.');
    setStatus('error', 'Mic error');
  }
}

/**
 * Stop recording audio
 */
function stopRecording(): void {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;

    // Stop audio stream
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }

    // Update UI
    micButton.classList.remove('recording');
    waveform.classList.remove('active');
    setStatus('processing', 'Processing...');
  }
}

/**
 * Process the recorded audio
 */
async function processRecording(): Promise<void> {
  if (audioChunks.length === 0) {
    setStatus('ready', 'Ready');
    transcriptionText.textContent = 'No audio recorded';
    transcriptionText.classList.remove('active');
    return;
  }

  try {
    // Convert audio chunks to ArrayBuffer
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Process through full pipeline
    const result = await window.voiceAPI.pipeline(arrayBuffer, { autoExecute: true });

    if (result.success) {
      // Show transcription
      if (result.transcription?.text) {
        transcriptionText.textContent = result.transcription.text;
        transcriptionText.classList.add('active');
      }

      // Show intent
      if (result.intent) {
        showIntent(result.intent);
      }

      // Show execution result
      if (result.execution) {
        if (result.execution.success) {
          const output = result.execution.output || 'Command executed successfully';
          showOutput(output);

          // Speak filtered output if TTS enabled
          if (ttsEnabled && result.execution.filteredOutput) {
            speakText(result.execution.filteredOutput);
          }
        } else {
          showError(result.execution.error || 'Execution failed');
        }
      }

      setStatus('ready', 'Ready');
    } else {
      showError(result.error || 'Processing failed');
      setStatus('error', `Failed: ${result.failedStage || 'unknown'}`);

      // Show partial results
      if (result.transcription?.text) {
        transcriptionText.textContent = result.transcription.text;
        transcriptionText.classList.add('active');
      }
    }
  } catch (error) {
    console.error('Processing error:', error);
    showError(error instanceof Error ? error.message : 'Processing failed');
    setStatus('error', 'Error');
  }
}

/**
 * Handle keyboard shortcuts
 */
function handleKeydown(event: KeyboardEvent): void {
  // Escape to cancel
  if (event.key === 'Escape') {
    if (isRecording) {
      // Cancel recording without processing
      if (mediaRecorder) {
        mediaRecorder.stop();
        isRecording = false;
        audioChunks = [];

        if (audioStream) {
          audioStream.getTracks().forEach(track => track.stop());
          audioStream = null;
        }

        micButton.classList.remove('recording');
        waveform.classList.remove('active');
        setStatus('ready', 'Cancelled');
        transcriptionText.textContent = 'Recording cancelled';
        transcriptionText.classList.remove('active');
      }
    }
  }
}

/**
 * Set status indicator
 */
function setStatus(state: 'ready' | 'listening' | 'processing' | 'error', text: string): void {
  statusDot.className = 'status-dot';

  switch (state) {
    case 'listening':
      statusDot.classList.add('listening');
      break;
    case 'processing':
      statusDot.classList.add('processing');
      break;
    case 'error':
      statusDot.classList.add('error');
      break;
  }

  statusText.textContent = text;
}

/**
 * Show intent information
 */
function showIntent(intent: { action: string; command?: string; target?: string; confidence: number }): void {
  intentArea.style.display = 'flex';
  intentArea.classList.add('fade-in');

  intentBadge.textContent = intent.action;
  intentBadge.className = `intent-badge ${intent.action}`;

  const displayCommand = intent.command || intent.target || 'No command';
  intentCommand.textContent = displayCommand;
}

/**
 * Hide intent information
 */
function hideIntent(): void {
  intentArea.style.display = 'none';
}

/**
 * Show output
 */
function showOutput(output: string): void {
  outputArea.style.display = 'block';
  outputArea.classList.add('fade-in');
  outputText.textContent = output;
  hideError();
}

/**
 * Hide output
 */
function hideOutput(): void {
  outputArea.style.display = 'none';
}

/**
 * Show error
 */
function showError(message: string): void {
  errorArea.style.display = 'block';
  errorArea.classList.add('fade-in');
  errorText.textContent = message;
  hideOutput();
}

/**
 * Hide error
 */
function hideError(): void {
  errorArea.style.display = 'none';
}

/**
 * Copy output to clipboard
 */
async function copyOutput(): Promise<void> {
  const text = outputText.textContent;
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      // Visual feedback
      const originalText = copyButton.innerHTML;
      copyButton.innerHTML = '<span style="font-size: 12px;">Copied!</span>';
      setTimeout(() => {
        copyButton.innerHTML = originalText;
      }, 1500);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }
}

// ==================== TTS Functions ====================

/**
 * Handle TTS enable/disable toggle
 */
function handleTTSToggle(event: Event): void {
  const target = event.target as HTMLInputElement;
  ttsEnabled = target.checked;
  updateTTSStatus(ttsSpeaking);

  if (ttsStatusEl) {
    ttsStatusEl.textContent = ttsEnabled ? 'Ready' : 'Disabled';
  }
}

/**
 * Stop TTS playback
 */
async function stopTTS(): Promise<void> {
  try {
    await window.voiceAPI.stopTTS();
    updateTTSStatus(false);
  } catch (error) {
    console.error('Failed to stop TTS:', error);
  }
}

/**
 * Set output view mode (filtered or full)
 */
function setOutputView(mode: 'filtered' | 'full'): void {
  showFilteredOutput = (mode === 'filtered');

  // Update button states
  toggleFilteredBtn?.classList.toggle('active', showFilteredOutput);
  toggleFullBtn?.classList.toggle('active', !showFilteredOutput);

  // Toggle visibility
  if (filteredOutputEl) {
    filteredOutputEl.style.display = showFilteredOutput ? 'block' : 'none';
  }
  if (outputArea) {
    outputArea.style.display = showFilteredOutput ? 'none' : 'block';
  }
}

/**
 * Show filtered output text (for TTS)
 */
function showFilteredOutputText(text: string): void {
  if (filteredOutputEl) {
    filteredOutputEl.textContent = text;
    filteredOutputEl.style.display = 'block';
    filteredOutputEl.scrollTop = filteredOutputEl.scrollHeight;
  }
  if (outputToggle) {
    outputToggle.style.display = 'flex';
  }
}

/**
 * Update TTS status in UI
 */
function updateTTSStatus(speaking: boolean, text?: string): void {
  ttsSpeaking = speaking;

  // Update stop button state
  if (ttsStopBtn) {
    ttsStopBtn.disabled = !speaking;
  }

  // Update TTS badge
  if (ttsBadge) {
    if (speaking) {
      ttsBadge.classList.add('speaking');
    } else {
      ttsBadge.classList.remove('speaking');
    }
  }

  // Update status text
  if (ttsStatusEl) {
    if (speaking && text) {
      const truncatedText = text.length > 30 ? text.substring(0, 30) + '...' : text;
      ttsStatusEl.textContent = `Speaking: ${truncatedText}`;
      ttsStatusEl.classList.add('speaking');
    } else {
      ttsStatusEl.textContent = ttsEnabled ? 'Ready' : 'Disabled';
      ttsStatusEl.classList.remove('speaking');
    }
  }
}

/**
 * Speak text through TTS (if enabled)
 */
async function speakText(text: string): Promise<void> {
  if (!ttsEnabled || !text) return;

  try {
    updateTTSStatus(true, text);
    showFilteredOutputText(text);

    const result = await window.voiceAPI.speak(text);

    if (!result.success) {
      console.error('TTS failed:', result.error);
    }
  } catch (error) {
    console.error('TTS error:', error);
  } finally {
    updateTTSStatus(false);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
