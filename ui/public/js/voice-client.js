/**
 * Voice Agent Client
 *
 * Browser-side JavaScript for audio capture, waveform visualization,
 * and communication with the voice agent API.
 */

(function() {
  'use strict';

  // API endpoints
  const API_BASE = '/api/voice';

  // State
  let state = 'idle';
  let sessionId = null;
  let eventSource = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let audioContext = null;
  let analyser = null;
  let animationId = null;
  let history = [];

  // DOM elements
  const micButton = document.getElementById('mic-button');
  const recordingStatus = document.getElementById('recording-status');
  const stateBadge = document.getElementById('state-badge');
  const transcriptionText = document.getElementById('transcription-text');
  const intentDisplay = document.getElementById('intent-display');
  const intentAction = document.getElementById('intent-action');
  const intentCommand = document.getElementById('intent-command');
  const intentConfidence = document.getElementById('intent-confidence');
  const confirmationDialog = document.getElementById('confirmation-dialog');
  const confirmBtn = document.getElementById('confirm-btn');
  const rejectBtn = document.getElementById('reject-btn');
  const outputDisplay = document.getElementById('output-display');
  const filteredOutput = document.getElementById('filtered-output');
  const historyList = document.getElementById('history-list');
  const sttStatus = document.getElementById('stt-status');
  const ollamaStatus = document.getElementById('ollama-status');
  const claudeCodeStatus = document.getElementById('claude-code-status');
  const ttsStatusDot = document.getElementById('tts-status-dot');
  const sessionStatus = document.getElementById('session-status');
  const waveformCanvas = document.getElementById('waveform');
  const waveformCtx = waveformCanvas.getContext('2d');

  // TTS elements
  const ttsEnabled = document.getElementById('tts-enabled');
  const ttsStopBtn = document.getElementById('tts-stop-btn');
  const ttsStatusText = document.getElementById('tts-status');
  const toggleSummaryBtn = document.getElementById('toggle-summary');
  const toggleFilteredBtn = document.getElementById('toggle-filtered');
  const toggleFullBtn = document.getElementById('toggle-full');
  const summaryOutput = document.getElementById('summary-output');
  const voiceSelect = document.getElementById('voice-select');

  // Settings panel elements
  const settingsToggleBtn = document.getElementById('settings-toggle-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const ttsProviderSelect = document.getElementById('tts-provider-select');
  const voiceSelectSettings = document.getElementById('voice-select-settings');
  const voiceLoadingIndicator = document.getElementById('voice-loading-indicator');
  const rateSlider = document.getElementById('rate-slider');
  const rateValue = document.getElementById('rate-value');
  const rateFill = document.getElementById('rate-fill');
  const volumeSlider = document.getElementById('volume-slider');
  const volumeValue = document.getElementById('volume-value');
  const volumeFill = document.getElementById('volume-fill');

  // TTS state
  let ttsSpeaking = false;
  let outputViewMode = 'summary'; // 'summary' | 'filtered' | 'full'
  let ttsEnabledState = true;
  let currentVoice = 'alba';
  let currentSummary = ''; // Store last summary for display
  let currentProvider = 'macos';
  let currentRate = 175;
  let currentVolume = 80;

  // Wake word state
  let wakeWordEnabled = false;
  let wakeWordListening = false;
  let speechRecognition = null;
  let wakeWordMode = 'client'; // 'server' | 'client' | 'disabled'
  let serverWakeWordAvailable = false;
  let serverWakeWordStream = null;
  let serverWakeWordRecorder = null;
  const wakeWordIndicator = document.getElementById('wake-word-indicator');
  const wakeWordStatus = document.getElementById('wake-word-status');
  const wakeWordToggle = document.getElementById('wake-word-enabled');
  const privacyIndicator = document.getElementById('privacy-indicator');

  /**
   * Initialize the voice client
   */
  async function init() {
    recordingStatus.textContent = 'Checking services...';

    // Check service health
    await checkHealth();

    // Create session
    await createSession();

    // Set up event listeners
    micButton.addEventListener('click', toggleRecording);
    confirmBtn.addEventListener('click', confirmAction);
    rejectBtn.addEventListener('click', rejectAction);

    // Set up TTS event listeners
    if (ttsEnabled) {
      ttsEnabled.addEventListener('change', handleTTSToggle);
    }
    if (ttsStopBtn) {
      ttsStopBtn.addEventListener('click', stopTTS);
    }
    if (toggleSummaryBtn) {
      toggleSummaryBtn.addEventListener('click', () => setOutputView('summary'));
    }
    if (toggleFilteredBtn) {
      toggleFilteredBtn.addEventListener('click', () => setOutputView('filtered'));
    }
    if (toggleFullBtn) {
      toggleFullBtn.addEventListener('click', () => setOutputView('full'));
    }
    if (voiceSelect) {
      voiceSelect.addEventListener('change', handleVoiceChange);
      // Load available voices
      loadVoices();
    }

    // Set up settings panel event listeners
    if (settingsToggleBtn) {
      settingsToggleBtn.addEventListener('click', toggleSettingsPanel);
    }
    if (ttsProviderSelect) {
      ttsProviderSelect.addEventListener('change', handleProviderChange);
    }
    if (voiceSelectSettings) {
      voiceSelectSettings.addEventListener('change', handleVoiceChangeSettings);
    }
    if (rateSlider) {
      rateSlider.addEventListener('input', handleRateChange);
    }
    if (volumeSlider) {
      volumeSlider.addEventListener('input', handleVolumeChange);
    }

    // Load saved settings
    loadSavedSettings();

    // Set up waveform canvas
    resizeWaveformCanvas();
    window.addEventListener('resize', resizeWaveformCanvas);

    // Load wake word preference from localStorage
    wakeWordEnabled = localStorage.getItem('wakeWordEnabled') === 'true';

    // Set up wake word toggle event listener
    if (wakeWordToggle) {
      wakeWordToggle.checked = wakeWordEnabled;
      wakeWordToggle.addEventListener('change', handleWakeWordToggle);
    }

    // Update privacy indicator initial state
    updatePrivacyIndicator(wakeWordEnabled);

    // Check if server-side wake word detection is available
    await checkServerWakeWordAvailability();

    // Enable button if ready
    if (sessionId) {
      micButton.disabled = false;
      recordingStatus.textContent = 'Click the microphone to start recording';
      updateState('idle');

      // Start wake word detection if enabled
      if (wakeWordEnabled) {
        startWakeWordDetection();
      }
    }
  }

  /**
   * Check if server-side wake word detection is available
   */
  async function checkServerWakeWordAvailability() {
    try {
      const response = await fetch(`${API_BASE}/wake-word/status`);
      const data = await response.json();

      serverWakeWordAvailable = data.available || false;

      if (serverWakeWordAvailable) {
        console.log('Server-side wake word detection available');
        wakeWordMode = 'server';
      } else {
        console.log('Server-side wake word not available, using client-side detection');
        wakeWordMode = 'client';
      }
    } catch (error) {
      console.warn('Failed to check server wake word status:', error);
      serverWakeWordAvailable = false;
      wakeWordMode = 'client';
    }
  }

  /**
   * Check service health
   */
  async function checkHealth() {
    try {
      const response = await fetch(`${API_BASE}/health`);
      const data = await response.json();

      sttStatus.className = 'status-dot ' + (data.services.sttServer.healthy ? 'healthy' : 'error');
      ollamaStatus.className = 'status-dot ' + (data.services.ollama.healthy ? 'healthy' : 'error');

      // Update Claude Code status
      if (claudeCodeStatus && data.services.claudeCode) {
        claudeCodeStatus.className = 'status-dot ' + (data.services.claudeCode.healthy ? 'healthy' : 'error');
      }

      // Update TTS status
      if (ttsStatusDot && data.services.tts) {
        ttsStatusDot.className = 'status-dot ' + (data.services.tts.healthy ? 'healthy' : 'error');
        ttsEnabledState = data.services.tts.enabled || false;
        if (ttsEnabled) {
          ttsEnabled.checked = ttsEnabledState;
        }
      }

      if (!data.services.sttServer.healthy) {
        recordingStatus.textContent = 'STT server not running. Start with: python ui/python/stt_server.py';
      }

      if (!data.services.ollama.healthy) {
        recordingStatus.textContent = 'Ollama not running. Start with: ollama serve';
      }
    } catch (error) {
      console.error('Health check failed:', error);
      sttStatus.className = 'status-dot error';
      ollamaStatus.className = 'status-dot error';
      if (claudeCodeStatus) claudeCodeStatus.className = 'status-dot error';
      if (ttsStatusDot) ttsStatusDot.className = 'status-dot error';
      recordingStatus.textContent = 'Could not connect to voice agent services';
    }
  }

  /**
   * Create a new voice session
   */
  async function createSession() {
    try {
      const response = await fetch(`${API_BASE}/session`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        sessionId = data.sessionId;
        sessionStatus.className = 'status-dot healthy';

        // Connect to SSE for session events
        connectSSE(data.sseUrl);
      } else {
        sessionStatus.className = 'status-dot error';
        console.error('Failed to create session:', data);
      }
    } catch (error) {
      console.error('Session creation failed:', error);
      sessionStatus.className = 'status-dot error';
    }
  }

  /**
   * Connect to Server-Sent Events for session updates
   */
  function connectSSE(url) {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(url);

    eventSource.onopen = function() {
      console.log('SSE connected');
    };

    eventSource.onerror = function(error) {
      console.error('SSE error:', error);
      sessionStatus.className = 'status-dot error';
    };

    eventSource.addEventListener('state_change', function(event) {
      const data = JSON.parse(event.data);
      updateState(data.data.newState);
    });

    eventSource.addEventListener('transcription', function(event) {
      const data = JSON.parse(event.data);
      showTranscription(data.data.text);
    });

    eventSource.addEventListener('intent', function(event) {
      const data = JSON.parse(event.data);
      showIntent(data.data.intent);
    });

    eventSource.addEventListener('confirmation_required', function(event) {
      const data = JSON.parse(event.data);
      showConfirmation(data.data.intent);
    });

    eventSource.addEventListener('execution_output', function(event) {
      const data = JSON.parse(event.data);
      appendOutput(data.data.text);
    });

    eventSource.addEventListener('execution_complete', function(event) {
      const data = JSON.parse(event.data);
      showExecutionResult(data.data);
    });

    eventSource.addEventListener('filtered_output', function(event) {
      const data = JSON.parse(event.data);
      showFilteredOutputText(data.data.text);
    });

    eventSource.addEventListener('tts_summary', function(event) {
      const data = JSON.parse(event.data);
      showTTSSummary(data.data.summary);
    });

    eventSource.addEventListener('tts_start', function(event) {
      const data = JSON.parse(event.data);
      updateTTSStatus(true, data.data.text);
    });

    eventSource.addEventListener('tts_complete', function(event) {
      updateTTSStatus(false);
    });

    eventSource.addEventListener('tts_error', function(event) {
      const data = JSON.parse(event.data);
      console.error('TTS error:', data.data.error);
      updateTTSStatus(false);
    });

    eventSource.addEventListener('heartbeat', function(event) {
      // Keep-alive, no action needed
    });
  }

  /**
   * Toggle recording state
   */
  async function toggleRecording() {
    if (state === 'listening') {
      stopRecording();
    } else {
      startRecording();
    }
  }

  /**
   * Start audio recording
   */
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up audio context for visualization
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;

      // Start waveform visualization
      drawWaveform();

      // Set up media recorder
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = function(event) {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async function() {
        cancelAnimationFrame(animationId);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        // Process audio
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      micButton.classList.add('recording');
      recordingStatus.textContent = 'Recording... Click to stop';
      updateState('listening');

      // Update session state
      await updateSessionState('listening');

    } catch (error) {
      console.error('Failed to start recording:', error);
      recordingStatus.textContent = 'Microphone access denied';
      updateState('error');
    }
  }

  /**
   * Stop audio recording
   */
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      micButton.classList.remove('recording');
      recordingStatus.textContent = 'Processing...';
    }
  }

  /**
   * Process recorded audio
   */
  async function processAudio(audioBlob) {
    updateState('transcribing');
    recordingStatus.textContent = 'Transcribing...';

    try {
      // Send audio for transcription
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      const response = await fetch(`${API_BASE}/transcribe`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success && result.text) {
        showTranscription(result.text);
        await classifyIntent(result.text);
      } else {
        showError(result.error || 'Transcription failed');
      }
    } catch (error) {
      console.error('Audio processing failed:', error);
      showError('Failed to process audio');
    }
  }

  /**
   * Classify the transcribed text
   */
  async function classifyIntent(text) {
    updateState('classifying');
    recordingStatus.textContent = 'Analyzing command...';

    try {
      // Send text for intent classification (via process text endpoint)
      const response = await fetch(`${API_BASE}/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });

      // If endpoint doesn't exist, use mock classification for MVP demo
      if (!response.ok) {
        // Mock classification for MVP
        const mockIntent = mockClassify(text);
        showIntent(mockIntent);

        if (mockIntent.requiresConfirmation) {
          showConfirmation(mockIntent);
        } else {
          await executeIntent(mockIntent);
        }
        return;
      }

      const result = await response.json();

      if (result.success && result.intent) {
        showIntent(result.intent);

        if (result.intent.requiresConfirmation) {
          showConfirmation(result.intent);
        } else {
          await executeIntent(result.intent);
        }
      } else {
        showError(result.error || 'Intent classification failed');
      }
    } catch (error) {
      console.error('Classification failed:', error);
      // Fall back to mock classification
      const mockIntent = mockClassify(text);
      showIntent(mockIntent);

      if (mockIntent.requiresConfirmation) {
        showConfirmation(mockIntent);
      } else {
        await executeIntent(mockIntent);
      }
    }
  }

  /**
   * Mock intent classification for MVP demo
   */
  function mockClassify(text) {
    const lowerText = text.toLowerCase();

    // Claude Code - explicit requests to Claude
    if (lowerText.match(/^(ask|tell)\s+claude/i)) {
      return {
        action: 'claude_code',
        command: text.replace(/^(ask|tell)\s+claude\s*/i, ''),
        confidence: 0.95,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Claude Code - coding tasks (create, write, build, implement, fix, refactor, etc.)
    if (lowerText.match(/^(create|write|build|implement|add|fix|refactor|update|modify|change)\s+(a\s+)?(function|class|component|module|file|test|code|method|api|endpoint|feature)/i)) {
      return {
        action: 'claude_code',
        command: text,
        confidence: 0.9,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Claude Code - explanation/question commands
    if (lowerText.match(/^(what|how|why|where|explain|show|describe)\s+(is|does|do|are|the|this|that|me)/i)) {
      return {
        action: 'claude_code',
        command: text,
        confidence: 0.85,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Claude Code - follow-up commands
    if (lowerText.match(/^(now|then|also|next|and)\s+(fix|update|add|change|commit|push|create|write|refactor)/i)) {
      return {
        action: 'claude_code',
        command: text,
        confidence: 0.9,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // NPM commands
    if (lowerText.includes('npm')) {
      const match = text.match(/npm\s+(\S+)/i);
      return {
        action: 'terminal',
        command: match ? `npm ${match[1]}` : 'npm --help',
        confidence: 0.9,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Git commands
    if (lowerText.includes('git')) {
      const match = text.match(/git\s+(\S+)/i);
      return {
        action: 'terminal',
        command: match ? `git ${match[1]}` : 'git status',
        confidence: 0.9,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // List files
    if (lowerText.includes('list') || lowerText.includes('ls')) {
      return {
        action: 'terminal',
        command: 'ls -la',
        confidence: 0.85,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Media controls (play, pause, stop music)
    if (lowerText.includes('play') && (lowerText.includes('music') || lowerText.includes('spotify'))) {
      const target = lowerText.includes('spotify') ? 'Spotify' : 'Music';
      return {
        action: 'app_control',
        command: 'play',
        target: target,
        parameters: { action: 'play' },
        confidence: 0.85,
        requiresConfirmation: false,
        originalText: text
      };
    }

    if (lowerText.includes('pause') || lowerText.includes('stop music')) {
      return {
        action: 'app_control',
        command: 'pause',
        target: 'Music',
        parameters: { action: 'pause' },
        confidence: 0.85,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Open app - extract just the app name (stop at "and", "then", punctuation, etc.)
    if (lowerText.includes('open')) {
      const match = text.match(/open\s+([a-zA-Z0-9\s]+?)(?:\s+and\s+|\s+then\s+|[.,!?]|$)/i);
      const appName = match ? match[1].trim() : 'Finder';
      // Clean up common words that might be captured
      const cleanAppName = appName.replace(/\s+(app|application|browser|player)$/i, '').trim();
      return {
        action: 'app_control',
        command: 'open',
        target: cleanAppName || 'Finder',
        parameters: { action: 'open' },
        confidence: 0.8,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Ralph commands
    if (lowerText.includes('ralph') || lowerText.includes('prd') || lowerText.includes('build')) {
      if (lowerText.includes('prd')) {
        return {
          action: 'ralph_command',
          command: 'ralph prd',
          confidence: 0.8,
          requiresConfirmation: false,
          originalText: text
        };
      }
      if (lowerText.includes('build')) {
        return {
          action: 'ralph_command',
          command: 'ralph build 1',
          confidence: 0.8,
          requiresConfirmation: false,
          originalText: text
        };
      }
    }

    // Destructive commands
    if (lowerText.includes('delete') || lowerText.includes('remove') || lowerText.includes('rm')) {
      return {
        action: 'terminal',
        command: text.replace(/^(run\s+)?/i, ''),
        confidence: 0.7,
        requiresConfirmation: true,
        originalText: text
      };
    }

    // Unknown - but might be a Claude Code request if it sounds like a question or task
    if (lowerText.match(/^(can|could|would|should|please|help|i need|i want)/i)) {
      return {
        action: 'claude_code',
        command: text,
        confidence: 0.6,
        requiresConfirmation: false,
        originalText: text
      };
    }

    // Unknown
    return {
      action: 'unknown',
      command: null,
      confidence: 0.3,
      requiresConfirmation: false,
      originalText: text
    };
  }

  /**
   * Execute an intent
   */
  async function executeIntent(intent) {
    updateState('executing');
    recordingStatus.textContent = 'Executing...';
    outputDisplay.textContent = '';

    if (intent.action === 'unknown') {
      showInfo('That doesn\'t look like a command. Try saying:\n• "open chrome"\n• "run npm test"\n• "list files"\n• "create a prd for login"');
      return;
    }

    try {
      // Show command being executed
      appendOutput(`$ ${intent.command || intent.target || intent.action}\n`);

      // Call the actual backend API to execute the intent
      const response = await fetch(`${API_BASE}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ intent })
      });

      const result = await response.json();

      if (result.success) {
        // Show output from actual execution
        if (result.output) {
          appendOutput(result.output + '\n');
        }
        appendOutput('\n[Completed successfully]\n');
        addToHistory(intent, true);

        // Update filtered output and summary
        if (result.filteredOutput) {
          showFilteredOutputText(result.filteredOutput);
        }
        if (result.ttsSummary) {
          showTTSSummary(result.ttsSummary);
        }
      } else {
        appendOutput(`\n[Error: ${result.error || 'Execution failed'}]\n`);
        addToHistory(intent, false);
      }

      // Return to idle
      updateState('idle');
      recordingStatus.textContent = 'Click the microphone to start recording';

    } catch (error) {
      console.error('Execution failed:', error);
      showError('Execution failed: ' + error.message);
      addToHistory(intent, false);
    }
  }

  /**
   * Simulate command execution (MVP demo)
   */
  async function simulateExecution(intent) {
    // Show command being executed
    appendOutput(`$ ${intent.command || intent.target}\n`);

    // Simulate output based on command
    const command = intent.command || '';

    await sleep(500);

    if (command.includes('npm test')) {
      appendOutput('\n> Running tests...\n');
      await sleep(300);
      appendOutput('PASS  tests/example.test.js\n');
      appendOutput('  Example tests\n');
      appendOutput('    OK: should pass (2ms)\n');
      appendOutput('\nTest Suites: 1 passed, 1 total\n');
      appendOutput('Tests:       1 passed, 1 total\n');
    } else if (command.includes('git status')) {
      appendOutput('On branch main\n');
      appendOutput('Your branch is up to date with \'origin/main\'.\n\n');
      appendOutput('nothing to commit, working tree clean\n');
    } else if (command.includes('ls')) {
      appendOutput('total 48\n');
      appendOutput('drwxr-xr-x  12 user  staff   384 Jan 17 10:00 .\n');
      appendOutput('drwxr-xr-x   5 user  staff   160 Jan 17 09:00 ..\n');
      appendOutput('-rw-r--r--   1 user  staff  1024 Jan 17 10:00 README.md\n');
      appendOutput('-rw-r--r--   1 user  staff  2048 Jan 17 10:00 package.json\n');
      appendOutput('drwxr-xr-x   8 user  staff   256 Jan 17 10:00 src\n');
    } else if (intent.action === 'app_control') {
      appendOutput(`Opening ${intent.target}...\n`);
      await sleep(500);
      appendOutput(`${intent.target} launched successfully.\n`);
    } else if (intent.action === 'ralph_command') {
      appendOutput('Starting Ralph...\n');
      await sleep(500);
      appendOutput('Ralph CLI v1.0.0\n');
    } else {
      appendOutput('Command executed.\n');
    }

    // Add to history
    addToHistory(intent, true);

    // Return to idle
    updateState('idle');
    recordingStatus.textContent = 'Click the microphone to start recording';
  }

  /**
   * Update UI state
   */
  function updateState(newState) {
    state = newState;

    // Update badge
    stateBadge.className = 'state-badge ' + newState;
    stateBadge.textContent = newState.charAt(0).toUpperCase() + newState.slice(1);

    // Update button state
    if (newState === 'idle' || newState === 'listening') {
      micButton.disabled = false;
    } else {
      micButton.disabled = true;
    }

    // Restart wake word detection when returning to idle (if enabled)
    if (newState === 'idle' && wakeWordEnabled && !wakeWordListening) {
      setTimeout(() => {
        startWakeWordDetection();
      }, 500);
    }
  }

  /**
   * Update session state on server
   */
  async function updateSessionState(newState) {
    if (!sessionId) return;

    try {
      await fetch(`${API_BASE}/session/${sessionId}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: newState })
      });
    } catch (error) {
      console.error('Failed to update session state:', error);
    }
  }

  /**
   * Show transcription result
   */
  function showTranscription(text) {
    transcriptionText.textContent = text;
    transcriptionText.classList.remove('placeholder');
  }

  /**
   * Show classified intent
   */
  function showIntent(intent) {
    intentDisplay.style.display = 'block';
    intentAction.textContent = intent.action;
    intentAction.className = 'action-badge ' + intent.action;
    intentCommand.textContent = intent.command || intent.target || '-';
    intentConfidence.textContent = Math.round((intent.confidence || 0) * 100) + '%';
  }

  /**
   * Show confirmation dialog
   */
  function showConfirmation(intent) {
    updateState('confirming');
    confirmationDialog.classList.add('show');
    confirmationDialog.dataset.intent = JSON.stringify(intent);
    recordingStatus.textContent = 'Waiting for confirmation...';
  }

  /**
   * Confirm action
   */
  async function confirmAction() {
    confirmationDialog.classList.remove('show');
    const intent = JSON.parse(confirmationDialog.dataset.intent || '{}');
    await executeIntent(intent);
  }

  /**
   * Reject action
   */
  function rejectAction() {
    confirmationDialog.classList.remove('show');
    updateState('idle');
    recordingStatus.textContent = 'Action cancelled. Click the microphone to try again';
  }

  /**
   * Append text to output display
   */
  function appendOutput(text) {
    outputDisplay.textContent += text;
    outputDisplay.scrollTop = outputDisplay.scrollHeight;
  }

  /**
   * Show execution result
   */
  function showExecutionResult(result) {
    if (result.success) {
      appendOutput('\n[Completed successfully]\n');
    } else {
      appendOutput(`\n[Error: ${result.error}]\n`);
    }

    updateState('idle');
    recordingStatus.textContent = 'Click the microphone to start recording';
  }

  /**
   * Show error message
   */
  function showError(message) {
    updateState('error');
    recordingStatus.textContent = message;
    outputDisplay.textContent = `Error: ${message}`;

    setTimeout(() => {
      if (state === 'error') {
        updateState('idle');
        recordingStatus.textContent = 'Click the microphone to try again';
      }
    }, 3000);
  }

  /**
   * Show info message (not an error)
   */
  function showInfo(message) {
    updateState('idle');
    recordingStatus.textContent = 'Click the microphone to try again';
    outputDisplay.textContent = message;
    outputDisplay.style.background = '#1e3a5f';  // Blue-ish instead of red

    setTimeout(() => {
      outputDisplay.style.background = '';  // Reset to default
    }, 5000);
  }

  /**
   * Add command to history
   */
  function addToHistory(intent, success) {
    const item = {
      intent,
      success,
      timestamp: new Date()
    };

    history.unshift(item);
    history = history.slice(0, 10); // Keep last 10

    renderHistory();
  }

  /**
   * Render command history
   */
  function renderHistory() {
    historyList.innerHTML = history.map(item => `
      <div class="history-item">
        <div class="history-command">${item.intent.command || item.intent.target || item.intent.originalText}</div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px;">
          <span class="history-time">${formatTime(item.timestamp)}</span>
          <span class="history-status ${item.success ? 'success' : 'error'}">
            ${item.success ? 'Success' : 'Failed'}
          </span>
        </div>
      </div>
    `).join('');
  }

  /**
   * Format timestamp
   */
  function formatTime(date) {
    return date.toLocaleTimeString();
  }

  /**
   * Draw waveform visualization
   */
  function drawWaveform() {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animationId = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      const width = waveformCanvas.width;
      const height = waveformCanvas.height;

      waveformCtx.fillStyle = '#f3f4f6';
      waveformCtx.fillRect(0, 0, width, height);

      waveformCtx.lineWidth = 2;
      waveformCtx.strokeStyle = '#3b82f6';
      waveformCtx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          waveformCtx.moveTo(x, y);
        } else {
          waveformCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      waveformCtx.lineTo(width, height / 2);
      waveformCtx.stroke();
    }

    draw();
  }

  /**
   * Resize waveform canvas to match container
   */
  function resizeWaveformCanvas() {
    const container = waveformCanvas.parentElement;
    waveformCanvas.width = container.clientWidth;
    waveformCanvas.height = container.clientHeight;
  }

  /**
   * Sleep helper
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== TTS Functions ====================

  /**
   * Handle TTS enable/disable toggle
   */
  async function handleTTSToggle(event) {
    const enabled = event.target.checked;
    try {
      const endpoint = enabled ? `${API_BASE}/tts/enable` : `${API_BASE}/tts/disable`;
      const response = await fetch(endpoint, { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        ttsEnabledState = enabled;
        // Save to localStorage
        localStorage.setItem('ttsEnabled', enabled.toString());
        if (ttsStatusText) {
          ttsStatusText.textContent = enabled ? 'TTS enabled' : 'TTS disabled';
        }
        // Sync to server for persistence
        syncSettingsToServer();
      } else {
        // Revert checkbox on failure
        event.target.checked = !enabled;
        console.error('Failed to toggle TTS:', result.error);
      }
    } catch (error) {
      // Revert checkbox on error
      event.target.checked = !enabled;
      console.error('TTS toggle error:', error);
    }
  }

  /**
   * Stop TTS playback
   */
  async function stopTTS() {
    try {
      const response = await fetch(`${API_BASE}/tts/stop`, { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        updateTTSStatus(false);
      }
    } catch (error) {
      console.error('Failed to stop TTS:', error);
    }
  }

  /**
   * Load available TTS voices
   */
  async function loadVoices() {
    try {
      const response = await fetch(`${API_BASE}/tts/voices`);
      const result = await response.json();

      if (result.success && voiceSelect) {
        // Clear existing options
        voiceSelect.innerHTML = '';

        // Voice display names
        const voiceNames = {
          alba: 'Alba (Scottish)',
          jenny: 'Jenny (British)',
          lessac: 'Lessac (American)',
          ryan: 'Ryan (American)',
          libritts: 'LibriTTS (Multi)',
          hfc_female: 'HFC Female',
        };

        // Add voice options
        for (const voice of result.voices) {
          const option = document.createElement('option');
          option.value = voice;
          option.textContent = voiceNames[voice] || voice;
          voiceSelect.appendChild(option);
        }

        // Set current voice
        if (result.currentVoice) {
          currentVoice = result.currentVoice;
          voiceSelect.value = currentVoice;
        }
      }
    } catch (error) {
      console.error('Failed to load voices:', error);
    }
  }

  /**
   * Handle voice selection change
   */
  async function handleVoiceChange(event) {
    const selectedVoice = event.target.value;
    try {
      const response = await fetch(`${API_BASE}/tts/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: selectedVoice }),
      });
      const result = await response.json();

      if (result.success) {
        currentVoice = result.voice;
        if (ttsStatusText) {
          ttsStatusText.textContent = `Voice: ${currentVoice}`;
          // Reset after a moment
          setTimeout(() => {
            if (!ttsSpeaking) {
              ttsStatusText.textContent = ttsEnabledState ? 'TTS ready' : 'TTS disabled';
            }
          }, 2000);
        }
      } else {
        // Revert selection on failure
        event.target.value = currentVoice;
        console.error('Failed to set voice:', result.error);
      }
    } catch (error) {
      event.target.value = currentVoice;
      console.error('Voice change error:', error);
    }
  }

  /**
   * Set output view mode (summary, filtered, or full)
   */
  function setOutputView(mode) {
    outputViewMode = mode;

    // Update button states
    if (toggleSummaryBtn) {
      toggleSummaryBtn.classList.toggle('active', mode === 'summary');
    }
    if (toggleFilteredBtn) {
      toggleFilteredBtn.classList.toggle('active', mode === 'filtered');
    }
    if (toggleFullBtn) {
      toggleFullBtn.classList.toggle('active', mode === 'full');
    }

    // Toggle visibility based on mode
    if (summaryOutput) {
      summaryOutput.style.display = mode === 'summary' && currentSummary ? 'block' : 'none';
    }
    if (filteredOutput) {
      filteredOutput.style.display = mode === 'filtered' ? 'block' : 'none';
    }
    if (outputDisplay) {
      outputDisplay.style.display = mode === 'full' ? 'block' : 'none';
    }
  }

  /**
   * Show filtered output text (for TTS)
   */
  function showFilteredOutputText(text) {
    if (filteredOutput) {
      filteredOutput.textContent = text;
      filteredOutput.scrollTop = filteredOutput.scrollHeight;
    }
  }

  /**
   * Show TTS summary (LLM-generated for long outputs)
   */
  function showTTSSummary(summary) {
    currentSummary = summary || '';
    if (summaryOutput) {
      summaryOutput.textContent = summary || '';
      // Show summary section if we're in summary mode and have content
      if (outputViewMode === 'summary' && summary) {
        summaryOutput.style.display = 'block';
      }
    }
  }

  /**
   * Update TTS status in UI
   */
  function updateTTSStatus(speaking, text) {
    ttsSpeaking = speaking;

    // Update stop button state
    if (ttsStopBtn) {
      ttsStopBtn.disabled = !speaking;
    }

    // Update status text
    if (ttsStatusText) {
      if (speaking) {
        const truncatedText = text && text.length > 50 ? text.substring(0, 50) + '...' : text;
        ttsStatusText.textContent = `Speaking: ${truncatedText || 'Processing...'}`;
      } else {
        ttsStatusText.textContent = ttsEnabledState ? 'TTS ready' : 'TTS disabled';
      }
    }

    // Update TTS status dot
    if (ttsStatusDot) {
      if (speaking) {
        ttsStatusDot.className = 'status-dot speaking';
      } else {
        ttsStatusDot.className = 'status-dot ' + (ttsEnabledState ? 'healthy' : 'warning');
      }
    }
  }

  /**
   * Manually speak text through TTS
   */
  async function speakText(text) {
    if (!ttsEnabledState) {
      console.log('TTS is disabled');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/tts/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const result = await response.json();

      if (result.success) {
        updateTTSStatus(true, text);
      } else {
        console.error('TTS speak failed:', result.error);
      }
    } catch (error) {
      console.error('TTS speak error:', error);
    }
  }

  // ==================== Wake Word Detection ====================

  /**
   * Start wake word detection
   * Uses server-side detection if available, falls back to client-side Web Speech API
   */
  function startWakeWordDetection() {
    // Don't start if already recording or listening
    if (state === 'listening' || wakeWordListening) {
      return;
    }

    // Try server-side detection first if available
    if (serverWakeWordAvailable && wakeWordMode === 'server') {
      startServerWakeWordDetection();
    } else {
      startClientWakeWordDetection();
    }
  }

  /**
   * Start server-side wake word detection
   * Continuously records short audio clips and sends them to the server for detection
   */
  async function startServerWakeWordDetection() {
    try {
      // Get microphone access
      serverWakeWordStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      wakeWordListening = true;
      updateWakeWordUI(true, 'Server listening');
      console.log('Server-side wake word detection started');

      // Start the detection loop
      processServerWakeWordLoop();

    } catch (error) {
      console.warn('Server wake word detection failed, falling back to client-side:', error);
      wakeWordMode = 'client';
      startClientWakeWordDetection();
    }
  }

  /**
   * Process server wake word detection loop
   * Records 2-second audio chunks and sends them for analysis
   */
  function processServerWakeWordLoop() {
    if (!wakeWordListening || !serverWakeWordStream || state === 'listening') {
      return;
    }

    try {
      const chunks = [];
      serverWakeWordRecorder = new MediaRecorder(serverWakeWordStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      serverWakeWordRecorder.ondataavailable = function(event) {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      serverWakeWordRecorder.onstop = async function() {
        if (!wakeWordListening || state === 'listening') {
          return;
        }

        // Create audio blob and send to server
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });

        // Only process if we have meaningful audio
        if (audioBlob.size > 1000) {
          try {
            const detected = await sendAudioForWakeWordDetection(audioBlob);

            if (detected) {
              // Wake word detected!
              console.log('Server detected wake word!');
              stopWakeWordDetection();
              recordingStatus.textContent = '"Hey Claude" detected! Starting recording...';

              // Automatically start recording
              setTimeout(() => {
                startRecording();
              }, 300);
              return;
            }
          } catch (error) {
            console.warn('Server wake word detection error:', error);
            // Fall back to client-side on repeated errors
            if (serverWakeWordAvailable) {
              console.log('Falling back to client-side detection');
              stopServerWakeWordDetection();
              wakeWordMode = 'client';
              startClientWakeWordDetection();
              return;
            }
          }
        }

        // Continue the loop if still listening
        if (wakeWordListening && state !== 'listening') {
          setTimeout(() => {
            processServerWakeWordLoop();
          }, 100); // Small delay between chunks
        }
      };

      // Record for 2 seconds (balance between latency and detection accuracy)
      serverWakeWordRecorder.start();
      setTimeout(() => {
        if (serverWakeWordRecorder && serverWakeWordRecorder.state === 'recording') {
          serverWakeWordRecorder.stop();
        }
      }, 2000);

    } catch (error) {
      console.warn('Server wake word loop error:', error);
      // Fall back to client-side
      stopServerWakeWordDetection();
      wakeWordMode = 'client';
      startClientWakeWordDetection();
    }
  }

  /**
   * Send audio to server for wake word detection
   */
  async function sendAudioForWakeWordDetection(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'wake-word-audio.webm');

    const response = await fetch(`${API_BASE}/wake-word`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.error && !result.detected) {
      throw new Error(result.error);
    }

    return result.detected === true;
  }

  /**
   * Stop server-side wake word detection
   */
  function stopServerWakeWordDetection() {
    if (serverWakeWordRecorder && serverWakeWordRecorder.state === 'recording') {
      serverWakeWordRecorder.stop();
    }
    serverWakeWordRecorder = null;

    if (serverWakeWordStream) {
      serverWakeWordStream.getTracks().forEach(track => track.stop());
      serverWakeWordStream = null;
    }
  }

  /**
   * Start client-side wake word detection using Web Speech API
   */
  function startClientWakeWordDetection() {
    // Check for Web Speech API support
    const SpeechRecognitionAPI = window.webkitSpeechRecognition || window.SpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn('Web Speech API not supported in this browser');
      updateWakeWordUI(false, 'Not supported');
      return;
    }

    // Don't start if already recording or listening
    if (state === 'listening' || wakeWordListening) {
      return;
    }

    try {
      speechRecognition = new SpeechRecognitionAPI();
      speechRecognition.continuous = true;
      speechRecognition.interimResults = true;
      speechRecognition.lang = 'en-US';

      speechRecognition.onresult = function(event) {
        handleWakeWordResult(event);
      };

      speechRecognition.onerror = function(event) {
        handleWakeWordError(event);
      };

      speechRecognition.onend = function() {
        // Restart if still enabled and not in recording state
        if (wakeWordEnabled && state !== 'listening' && state !== 'transcribing') {
          try {
            speechRecognition.start();
          } catch (e) {
            // Ignore errors when restarting
          }
        }
      };

      speechRecognition.start();
      wakeWordListening = true;
      updateWakeWordUI(true, 'Listening');
      console.log('Client-side wake word detection started');

    } catch (error) {
      console.error('Failed to start wake word detection:', error);
      updateWakeWordUI(false, 'Error');
    }
  }

  /**
   * Stop wake word detection (both server and client-side)
   */
  function stopWakeWordDetection() {
    // Stop server-side detection
    stopServerWakeWordDetection();

    // Stop client-side detection
    if (speechRecognition) {
      try {
        speechRecognition.abort();
      } catch (e) {
        // Ignore errors
      }
      speechRecognition = null;
    }
    wakeWordListening = false;
    updateWakeWordUI(false, 'Disabled');
    console.log('Wake word detection stopped');
  }

  /**
   * Handle wake word speech recognition results
   */
  function handleWakeWordResult(event) {
    const results = event.results;

    for (let i = event.resultIndex; i < results.length; i++) {
      const result = results[i];
      const transcript = result[0].transcript.toLowerCase().trim();

      // Check for wake phrase
      if (containsWakePhrase(transcript)) {
        console.log('Wake word detected:', transcript);

        // Temporarily stop wake word detection
        stopWakeWordDetection();

        // Show detection in UI
        recordingStatus.textContent = '"Hey Claude" detected! Starting recording...';

        // Automatically start recording
        setTimeout(() => {
          startRecording();
        }, 300);

        return;
      }
    }
  }

  /**
   * Check if transcript contains wake phrase
   */
  function containsWakePhrase(transcript) {
    const normalizedTranscript = transcript
      .replace(/[.,!?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Check for wake phrase variants (accounting for common misrecognitions)
    const variants = [
      'hey claude',
      'hey cloud',  // Common misrecognition
      'hey clod',
      'a claude',
      'hey claud',
      'hey claud e',
      'hay claude',
      'hi claude'
    ];

    return variants.some(variant => normalizedTranscript.includes(variant));
  }

  /**
   * Handle wake word detection errors
   */
  function handleWakeWordError(event) {
    console.warn('Wake word recognition error:', event.error);

    // Don't update UI for recoverable errors
    if (event.error === 'no-speech' || event.error === 'aborted') {
      return;
    }

    if (event.error === 'not-allowed') {
      updateWakeWordUI(false, 'Denied');
      wakeWordEnabled = false;
      localStorage.setItem('wakeWordEnabled', 'false');
    }
  }

  /**
   * Update wake word UI elements
   */
  function updateWakeWordUI(active, statusText) {
    // Update indicator visibility
    if (wakeWordIndicator) {
      if (active) {
        wakeWordIndicator.classList.add('active');
      } else {
        wakeWordIndicator.classList.remove('active');
      }
    }

    // Update status dot
    if (wakeWordStatus) {
      if (active) {
        wakeWordStatus.className = 'status-dot wake-word-active';
      } else if (statusText === 'Denied' || statusText === 'Error') {
        wakeWordStatus.className = 'status-dot error';
      } else if (statusText === 'Not supported') {
        wakeWordStatus.className = 'status-dot warning';
      } else {
        wakeWordStatus.className = 'status-dot';
      }
    }

    // Update privacy indicator
    updatePrivacyIndicator(active);
  }

  /**
   * Update privacy indicator visibility
   */
  function updatePrivacyIndicator(active) {
    if (privacyIndicator) {
      if (active) {
        privacyIndicator.classList.add('active');
      } else {
        privacyIndicator.classList.remove('active');
      }
    }
  }

  /**
   * Handle wake word toggle change
   */
  function handleWakeWordToggle(event) {
    const enabled = event.target.checked;
    toggleWakeWordDetection(enabled);
  }

  /**
   * Toggle wake word detection
   */
  function toggleWakeWordDetection(enabled) {
    wakeWordEnabled = enabled;
    localStorage.setItem('wakeWordEnabled', enabled ? 'true' : 'false');

    // Update checkbox state if called programmatically
    if (wakeWordToggle && wakeWordToggle.checked !== enabled) {
      wakeWordToggle.checked = enabled;
    }

    // Update privacy indicator
    updatePrivacyIndicator(enabled);

    if (enabled) {
      startWakeWordDetection();
    } else {
      stopWakeWordDetection();
    }
  }

  /**
   * Enable wake word detection externally
   */
  window.enableWakeWord = function() {
    toggleWakeWordDetection(true);
  };

  /**
   * Disable wake word detection externally
   */
  window.disableWakeWord = function() {
    toggleWakeWordDetection(false);
  };

  /**
   * Check if wake word detection is active
   */
  window.isWakeWordActive = function() {
    return wakeWordListening;
  };

  // ==================== Settings Panel Functions ====================

  /**
   * Toggle settings panel visibility
   */
  function toggleSettingsPanel() {
    const isOpen = settingsPanel.classList.contains('show');

    if (isOpen) {
      settingsPanel.classList.remove('show');
      settingsToggleBtn.classList.remove('active');
      settingsToggleBtn.setAttribute('aria-expanded', 'false');
      settingsPanel.setAttribute('aria-hidden', 'true');
    } else {
      settingsPanel.classList.add('show');
      settingsToggleBtn.classList.add('active');
      settingsToggleBtn.setAttribute('aria-expanded', 'true');
      settingsPanel.setAttribute('aria-hidden', 'false');

      // Refresh voices for current provider
      loadVoicesForProvider(currentProvider);
    }
  }

  /**
   * Load saved settings from localStorage and sync with server
   */
  async function loadSavedSettings() {
    // First, try to load settings from server config
    let serverConfig = null;
    try {
      const response = await fetch(`${API_BASE}/config`);
      const result = await response.json();
      if (result.success && result.config) {
        serverConfig = result.config;
      }
    } catch (error) {
      console.warn('Failed to load server config, using localStorage:', error);
    }

    // Load provider (prefer localStorage, fall back to server)
    const savedProvider = localStorage.getItem('ttsProvider');
    if (savedProvider && ttsProviderSelect) {
      currentProvider = savedProvider;
      ttsProviderSelect.value = savedProvider;
    } else if (serverConfig && serverConfig.provider && ttsProviderSelect) {
      currentProvider = serverConfig.provider;
      ttsProviderSelect.value = serverConfig.provider;
      localStorage.setItem('ttsProvider', serverConfig.provider);
    }

    // Load rate (prefer localStorage, fall back to server)
    const savedRate = localStorage.getItem('ttsRate');
    if (savedRate) {
      currentRate = parseInt(savedRate, 10);
      if (rateSlider) {
        rateSlider.value = currentRate;
        updateRateDisplay(currentRate);
      }
    } else if (serverConfig && serverConfig.rate) {
      currentRate = serverConfig.rate;
      if (rateSlider) {
        rateSlider.value = currentRate;
        updateRateDisplay(currentRate);
      }
      localStorage.setItem('ttsRate', currentRate.toString());
    }

    // Load volume (prefer localStorage, fall back to server)
    const savedVolume = localStorage.getItem('ttsVolume');
    if (savedVolume) {
      currentVolume = parseInt(savedVolume, 10);
      if (volumeSlider) {
        volumeSlider.value = currentVolume;
        updateVolumeDisplay(currentVolume);
      }
    } else if (serverConfig && serverConfig.volume) {
      // Server stores volume as 0-1, localStorage as 0-100
      currentVolume = Math.round(serverConfig.volume * 100);
      if (volumeSlider) {
        volumeSlider.value = currentVolume;
        updateVolumeDisplay(currentVolume);
      }
      localStorage.setItem('ttsVolume', currentVolume.toString());
    }

    // Load voice (prefer localStorage, fall back to server)
    const savedVoice = localStorage.getItem('ttsVoice');
    if (savedVoice) {
      currentVoice = savedVoice;
    } else if (serverConfig && serverConfig.voice) {
      currentVoice = serverConfig.voice;
      localStorage.setItem('ttsVoice', serverConfig.voice);
    }

    // Load TTS enabled state (prefer localStorage, fall back to server)
    const savedEnabled = localStorage.getItem('ttsEnabled');
    if (savedEnabled !== null) {
      ttsEnabledState = savedEnabled === 'true';
      if (ttsEnabled) {
        ttsEnabled.checked = ttsEnabledState;
      }
    } else if (serverConfig && typeof serverConfig.enabled === 'boolean') {
      ttsEnabledState = serverConfig.enabled;
      if (ttsEnabled) {
        ttsEnabled.checked = ttsEnabledState;
      }
      localStorage.setItem('ttsEnabled', serverConfig.enabled.toString());
    }

    // Sync current settings to server to ensure persistence
    syncSettingsToServer();
  }

  /**
   * Sync current localStorage settings to server for persistence
   */
  async function syncSettingsToServer() {
    const config = {
      provider: currentProvider,
      voice: currentVoice,
      rate: currentRate,
      volume: currentVolume / 100, // Convert to 0-1 range for server
      enabled: ttsEnabledState
    };

    try {
      const response = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      const result = await response.json();
      if (!result.success) {
        console.warn('Failed to sync settings to server:', result.error);
      }
    } catch (error) {
      console.warn('Failed to sync settings to server:', error);
    }
  }

  /**
   * Handle TTS provider change
   */
  async function handleProviderChange(event) {
    const newProvider = event.target.value;
    const previousProvider = currentProvider;

    // Show loading indicator
    if (voiceLoadingIndicator) {
      voiceLoadingIndicator.classList.add('show');
    }

    try {
      // Update provider on server
      const response = await fetch(`${API_BASE}/tts/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider })
      });

      const result = await response.json();

      if (result.success) {
        currentProvider = newProvider;
        localStorage.setItem('ttsProvider', newProvider);

        // Load voices for new provider
        await loadVoicesForProvider(newProvider);

        // Sync to server for persistence
        syncSettingsToServer();

        console.log('TTS provider changed to:', newProvider);
      } else {
        // Revert on failure
        event.target.value = previousProvider;
        console.error('Failed to change provider:', result.error);
      }
    } catch (error) {
      // Revert on error
      event.target.value = previousProvider;
      console.error('Provider change error:', error);
    } finally {
      if (voiceLoadingIndicator) {
        voiceLoadingIndicator.classList.remove('show');
      }
    }
  }

  /**
   * Load voices for a specific provider
   */
  async function loadVoicesForProvider(provider) {
    if (!voiceSelectSettings) return;

    const voiceErrorMessage = document.getElementById('voice-error-message');

    // Show loading indicator and clear error state
    if (voiceLoadingIndicator) {
      voiceLoadingIndicator.classList.add('show');
    }
    voiceSelectSettings.classList.remove('error');
    if (voiceErrorMessage) {
      voiceErrorMessage.classList.remove('show');
    }

    try {
      const response = await fetch(`${API_BASE}/tts/voices?provider=${provider}`);
      const result = await response.json();

      if (result.success && result.voices) {
        // Clear existing options
        voiceSelectSettings.innerHTML = '';

        // Define voice display names by provider
        const voiceDisplayNames = {
          macos: {
            'Alex': 'Alex (American)',
            'Samantha': 'Samantha (American)',
            'Victoria': 'Victoria (American)',
            'Daniel': 'Daniel (British)',
            'Karen': 'Karen (Australian)',
            'Moira': 'Moira (Irish)',
            'Tessa': 'Tessa (South African)'
          },
          elevenlabs: {
            'Rachel': 'Rachel (Calm)',
            'Drew': 'Drew (Confident)',
            'Clyde': 'Clyde (War Veteran)',
            'Paul': 'Paul (News)',
            'Domi': 'Domi (Assertive)',
            'Dave': 'Dave (Conversational)',
            'Fin': 'Fin (Sailor)',
            'Sarah': 'Sarah (Soft)',
            'Antoni': 'Antoni (Well-Rounded)',
            'Thomas': 'Thomas (Calm)',
            'Charlie': 'Charlie (Natural)',
            'Emily': 'Emily (Calm)',
            'Elli': 'Elli (Emotional)',
            'Callum': 'Callum (Character)',
            'Patrick': 'Patrick (Shouty)',
            'Harry': 'Harry (Anxious)',
            'Liam': 'Liam (Articulate)'
          },
          openai: {
            'alloy': 'Alloy (Neutral)',
            'echo': 'Echo (Warm)',
            'fable': 'Fable (British)',
            'onyx': 'Onyx (Deep)',
            'nova': 'Nova (Friendly)',
            'shimmer': 'Shimmer (Clear)'
          }
        };

        const displayNames = voiceDisplayNames[provider] || {};

        // Add voice options
        for (const voice of result.voices) {
          const option = document.createElement('option');
          option.value = voice;
          option.textContent = displayNames[voice] || voice;
          voiceSelectSettings.appendChild(option);
        }

        // Set current voice if it exists in the list
        if (result.currentVoice) {
          currentVoice = result.currentVoice;
          voiceSelectSettings.value = currentVoice;
        } else if (result.voices.length > 0) {
          // Select first voice if current not available
          voiceSelectSettings.value = result.voices[0];
          currentVoice = result.voices[0];
        }

        // Clear any error state on success
        voiceSelectSettings.classList.remove('error');
        if (voiceErrorMessage) {
          voiceErrorMessage.classList.remove('show');
        }
      } else {
        // Handle server error response
        throw new Error(result.error || 'No voices returned');
      }
    } catch (error) {
      console.error('Failed to load voices for provider:', error);
      // Show error option and error styling
      voiceSelectSettings.innerHTML = '<option value="">Error loading voices</option>';
      voiceSelectSettings.classList.add('error');
      if (voiceErrorMessage) {
        voiceErrorMessage.textContent = error.message || 'Failed to load voices';
        voiceErrorMessage.classList.add('show');
      }
    } finally {
      if (voiceLoadingIndicator) {
        voiceLoadingIndicator.classList.remove('show');
      }
    }
  }

  /**
   * Handle voice selection change from settings panel
   */
  async function handleVoiceChangeSettings(event) {
    const selectedVoice = event.target.value;
    const previousVoice = currentVoice;

    try {
      const response = await fetch(`${API_BASE}/tts/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: selectedVoice }),
      });
      const result = await response.json();

      if (result.success) {
        currentVoice = result.voice || selectedVoice;
        localStorage.setItem('ttsVoice', currentVoice);

        // Also update the legacy voice select if it exists
        if (voiceSelect) {
          voiceSelect.value = currentVoice;
        }

        // Sync to server for persistence
        syncSettingsToServer();

        console.log('Voice changed to:', currentVoice);
      } else {
        // Revert selection on failure
        event.target.value = previousVoice;
        console.error('Failed to set voice:', result.error);
      }
    } catch (error) {
      event.target.value = previousVoice;
      console.error('Voice change error:', error);
    }
  }

  /**
   * Handle speech rate slider change
   */
  function handleRateChange(event) {
    const rate = parseInt(event.target.value, 10);
    currentRate = rate;

    // Update display
    updateRateDisplay(rate);

    // Save to localStorage
    localStorage.setItem('ttsRate', rate.toString());

    // Debounce server update and sync
    clearTimeout(handleRateChange.timeout);
    handleRateChange.timeout = setTimeout(() => {
      updateServerRate(rate);
      syncSettingsToServer();
    }, 300);
  }

  /**
   * Update rate display and slider fill
   */
  function updateRateDisplay(rate) {
    if (rateValue) {
      rateValue.textContent = `${rate} WPM`;
    }
    if (rateFill) {
      // Calculate percentage (100-300 range)
      const percentage = ((rate - 100) / 200) * 100;
      rateFill.style.width = `${percentage}%`;
    }
  }

  /**
   * Update rate on server
   */
  async function updateServerRate(rate) {
    try {
      const response = await fetch(`${API_BASE}/tts/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate })
      });
      const result = await response.json();

      if (!result.success) {
        console.error('Failed to update rate:', result.error);
      }
    } catch (error) {
      console.error('Rate update error:', error);
    }
  }

  /**
   * Handle volume slider change
   */
  function handleVolumeChange(event) {
    const volume = parseInt(event.target.value, 10);
    currentVolume = volume;

    // Update display
    updateVolumeDisplay(volume);

    // Save to localStorage
    localStorage.setItem('ttsVolume', volume.toString());

    // Debounce server update and sync
    clearTimeout(handleVolumeChange.timeout);
    handleVolumeChange.timeout = setTimeout(() => {
      updateServerVolume(volume);
      syncSettingsToServer();
    }, 300);
  }

  /**
   * Update volume display and slider fill
   */
  function updateVolumeDisplay(volume) {
    if (volumeValue) {
      volumeValue.textContent = `${volume}%`;
    }
    if (volumeFill) {
      volumeFill.style.width = `${volume}%`;
    }
  }

  /**
   * Update volume on server
   */
  async function updateServerVolume(volume) {
    try {
      const response = await fetch(`${API_BASE}/tts/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume })
      });
      const result = await response.json();

      if (!result.success) {
        console.error('Failed to update volume:', result.error);
      }
    } catch (error) {
      console.error('Volume update error:', error);
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
