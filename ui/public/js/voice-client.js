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
  const toggleFilteredBtn = document.getElementById('toggle-filtered');
  const toggleFullBtn = document.getElementById('toggle-full');

  // TTS state
  let ttsSpeaking = false;
  let showFilteredOutput = true;
  let ttsEnabledState = true;

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
    if (toggleFilteredBtn) {
      toggleFilteredBtn.addEventListener('click', () => setOutputView('filtered'));
    }
    if (toggleFullBtn) {
      toggleFullBtn.addEventListener('click', () => setOutputView('full'));
    }

    // Set up waveform canvas
    resizeWaveformCanvas();
    window.addEventListener('resize', resizeWaveformCanvas);

    // Enable button if ready
    if (sessionId) {
      micButton.disabled = false;
      recordingStatus.textContent = 'Click the microphone to start recording';
      updateState('idle');
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
        if (ttsStatusText) {
          ttsStatusText.textContent = enabled ? 'TTS enabled' : 'TTS disabled';
        }
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
   * Set output view mode (filtered or full)
   */
  function setOutputView(mode) {
    showFilteredOutput = (mode === 'filtered');

    // Update button states
    if (toggleFilteredBtn) {
      toggleFilteredBtn.classList.toggle('active', showFilteredOutput);
    }
    if (toggleFullBtn) {
      toggleFullBtn.classList.toggle('active', !showFilteredOutput);
    }

    // Toggle visibility
    if (filteredOutput) {
      filteredOutput.style.display = showFilteredOutput ? 'block' : 'none';
    }
    if (outputDisplay) {
      outputDisplay.style.display = showFilteredOutput ? 'none' : 'block';
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

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
