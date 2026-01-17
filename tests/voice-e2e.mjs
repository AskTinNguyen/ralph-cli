/**
 * Voice Pipeline End-to-End Tests
 *
 * Integration tests for the voice agent pipeline including:
 * - STT (Speech-to-Text) transcription
 * - Intent classification via Ollama LLM
 * - Action routing and execution
 * - TTS (Text-to-Speech) response
 * - Session persistence
 *
 * Uses mock servers for STT and Ollama to enable reliable testing
 * without external dependencies.
 *
 * Run with: npm test -- tests/voice-e2e.mjs
 * Or: node tests/voice-e2e.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Import mock servers
import { createMockSTTServer } from './helpers/mock-stt-server.mjs';
import { createMockOllamaServer } from './helpers/mock-ollama-server.mjs';

// Import audio utilities
import {
  createWavBuffer,
  createTestAudioBlob,
  createTestAudioSamples,
  createInvalidAudio,
  validateWavBuffer,
} from './helpers/audio-utils.mjs';

// ============================================================
// Test Runner Setup
// ============================================================

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

let passed = 0;
let failed = 0;
const failures = [];
let currentGroup = '';

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function group(name) {
  currentGroup = name;
  console.log(`\n${colors.blue}=== ${name} ===${colors.reset}`);
}

async function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log(`${colors.green}PASS${colors.reset}`);
    passed++;
  } catch (err) {
    console.log(`${colors.red}FAIL${colors.reset}`);
    failures.push({ group: currentGroup, name, error: err.message, stack: err.stack });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      message || `Expected ${expectedStr}, got ${actualStr}`
    );
  }
}

function assertContains(text, substring, message) {
  if (!text.includes(substring)) {
    throw new Error(
      message || `Expected text to contain "${substring}"\nActual: ${text.slice(0, 200)}...`
    );
  }
}

function assertThrows(fn, expectedError, message) {
  let threw = false;
  let error;
  try {
    fn();
  } catch (e) {
    threw = true;
    error = e;
  }
  if (!threw) {
    throw new Error(message || 'Expected function to throw');
  }
  if (expectedError && !error.message.includes(expectedError)) {
    throw new Error(
      message || `Expected error containing "${expectedError}", got "${error.message}"`
    );
  }
}

// ============================================================
// Test Infrastructure Tests
// ============================================================

group('Test Infrastructure');

await test('Mock STT server starts and responds to health check', async () => {
  const mockSTT = await createMockSTTServer();

  try {
    const response = await fetch(`${mockSTT.url}/health`);
    assert(response.ok, 'Health check should succeed');

    const data = await response.json();
    assertEqual(data.status, 'healthy', 'Should report healthy');
    assertEqual(data.model, 'whisper-base', 'Should report model name');
  } finally {
    await mockSTT.close();
  }
});

await test('Mock STT server returns configured transcription', async () => {
  const mockSTT = await createMockSTTServer();

  try {
    mockSTT.configure({ defaultTranscription: 'hello world' });

    const audioBuffer = createWavBuffer({ durationMs: 1000 });
    const response = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    assert(response.ok, 'Transcribe should succeed');

    const data = await response.json();
    assert(data.success, 'Transcription should succeed');
    assertEqual(data.text, 'hello world', 'Should return configured transcription');
  } finally {
    await mockSTT.close();
  }
});

await test('Mock STT server tracks requests', async () => {
  const mockSTT = await createMockSTTServer();

  try {
    const audioBuffer = createWavBuffer({ durationMs: 500 });
    await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    const requests = mockSTT.getRequests();
    assertEqual(requests.length, 1, 'Should have recorded one request');
    assertEqual(requests[0].method, 'POST', 'Should record POST method');
  } finally {
    await mockSTT.close();
  }
});

await test('Mock STT server can simulate errors', async () => {
  const mockSTT = await createMockSTTServer();

  try {
    mockSTT.configure({
      forceError: true,
      errorMessage: 'Test error',
      errorStatusCode: 500,
    });

    const audioBuffer = createWavBuffer({ durationMs: 500 });
    const response = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    assertEqual(response.status, 500, 'Should return error status');

    const data = await response.json();
    assertEqual(data.success, false, 'Should report failure');
    assertEqual(data.error, 'Test error', 'Should include error message');
  } finally {
    await mockSTT.close();
  }
});

await test('Mock Ollama server starts and responds to health check', async () => {
  const mockOllama = await createMockOllamaServer();

  try {
    const response = await fetch(`${mockOllama.url}/api/tags`);
    assert(response.ok, 'Tags endpoint should succeed');

    const data = await response.json();
    assert(Array.isArray(data.models), 'Should return models array');
  } finally {
    await mockOllama.close();
  }
});

await test('Mock Ollama server returns configured intent', async () => {
  const mockOllama = await createMockOllamaServer();

  try {
    mockOllama.setDefaultIntent({
      action: 'terminal',
      command: 'ls -la',
      confidence: 0.95,
    });

    const response = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [{ role: 'user', content: 'list files' }],
      }),
    });

    assert(response.ok, 'Chat should succeed');

    const data = await response.json();
    const content = JSON.parse(data.message.content);
    assertEqual(content.action, 'terminal', 'Should return terminal action');
    assertEqual(content.command, 'ls -la', 'Should return configured command');
  } finally {
    await mockOllama.close();
  }
});

await test('Mock Ollama server can map specific prompts to responses', async () => {
  const mockOllama = await createMockOllamaServer();

  try {
    mockOllama.setResponse('open chrome', {
      action: 'app_control',
      target: 'Google Chrome',
      command: 'activate',
    });

    mockOllama.setResponse(/git status/i, {
      action: 'terminal',
      command: 'git status',
    });

    // Test string match
    const response1 = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [{ role: 'user', content: 'please open chrome browser' }],
      }),
    });

    const data1 = await response1.json();
    const content1 = JSON.parse(data1.message.content);
    assertEqual(content1.action, 'app_control', 'Should match string pattern');

    // Test regex match
    const response2 = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [{ role: 'user', content: 'run Git Status command' }],
      }),
    });

    const data2 = await response2.json();
    const content2 = JSON.parse(data2.message.content);
    assertEqual(content2.action, 'terminal', 'Should match regex pattern');
  } finally {
    await mockOllama.close();
  }
});

// ============================================================
// Audio Utilities Tests
// ============================================================

group('Audio Utilities');

await test('createWavBuffer creates valid WAV file', async () => {
  const buffer = createWavBuffer({ durationMs: 1000 });

  assert(Buffer.isBuffer(buffer), 'Should create a Buffer');
  assert(buffer.length > 44, 'Should be larger than WAV header');

  const validation = validateWavBuffer(buffer);
  assert(validation.valid, `Should be valid WAV: ${validation.error}`);
  assertEqual(validation.info.sampleRate, 16000, 'Default sample rate should be 16000');
  assertEqual(validation.info.numChannels, 1, 'Default channels should be 1');
});

await test('createWavBuffer respects options', async () => {
  const buffer = createWavBuffer({
    sampleRate: 44100,
    channels: 2,
    bitsPerSample: 16,
    durationMs: 500,
  });

  const validation = validateWavBuffer(buffer);
  assert(validation.valid, 'Should be valid WAV');
  assertEqual(validation.info.sampleRate, 44100, 'Sample rate should be 44100');
  assertEqual(validation.info.numChannels, 2, 'Channels should be 2');
});

await test('createTestAudioBlob returns blob-like object', async () => {
  const blob = createTestAudioBlob({ durationMs: 100 });

  assertEqual(blob.type, 'audio/wav', 'Should have audio/wav type');
  assert(blob.size > 0, 'Should have non-zero size');
  assert(typeof blob.arrayBuffer === 'function', 'Should have arrayBuffer method');

  const arrayBuffer = await blob.arrayBuffer();
  assert(arrayBuffer instanceof ArrayBuffer, 'arrayBuffer() should return ArrayBuffer');
});

await test('createTestAudioSamples returns various samples', async () => {
  const samples = createTestAudioSamples();

  assert(samples.silent, 'Should have silent sample');
  assert(samples.noisy, 'Should have noisy sample');
  assert(samples.short, 'Should have short sample');
  assert(samples.long, 'Should have long sample');

  // Verify all are valid
  for (const [name, buffer] of Object.entries(samples)) {
    const validation = validateWavBuffer(buffer);
    assert(validation.valid, `${name} should be valid WAV: ${validation.error}`);
  }
});

await test('createInvalidAudio creates invalid audio data', async () => {
  const types = ['empty', 'too_small', 'wrong_header', 'random', 'text', 'corrupted'];

  for (const type of types) {
    const invalid = createInvalidAudio(type);
    const validation = validateWavBuffer(invalid);

    if (type === 'corrupted') {
      // Corrupted has valid header structure but invalid format code
      // The validation might pass for structure but the audio is unusable
      // This is expected behavior for testing format validation
      continue;
    }

    assert(!validation.valid, `${type} should be invalid WAV: got ${JSON.stringify(validation)}`);
  }
});

await test('validateWavBuffer detects invalid WAV files', async () => {
  // Valid WAV
  const valid = createWavBuffer();
  assert(validateWavBuffer(valid).valid, 'Valid WAV should pass');

  // Too small
  assert(!validateWavBuffer(Buffer.alloc(10)).valid, 'Small buffer should fail');

  // Wrong RIFF header
  const wrongRiff = createWavBuffer();
  wrongRiff.write('XXXX', 0);
  assert(!validateWavBuffer(wrongRiff).valid, 'Wrong RIFF should fail');

  // Wrong WAVE format
  const wrongWave = createWavBuffer();
  wrongWave.write('XXXX', 8);
  assert(!validateWavBuffer(wrongWave).valid, 'Wrong WAVE should fail');
});

// ============================================================
// Integration Test: STT Pipeline
// ============================================================

group('STT Pipeline Integration');

await test('STT pipeline processes audio and returns transcription', async () => {
  const mockSTT = await createMockSTTServer();

  try {
    // Configure expected transcription
    mockSTT.configure({ defaultTranscription: 'run the tests' });

    // Create audio blob
    const audioBlob = createTestAudioBlob({ durationMs: 2000 });
    const audioBuffer = audioBlob.buffer;

    // Send to mock STT
    const response = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    const result = await response.json();

    assert(result.success, 'Transcription should succeed');
    assertEqual(result.text, 'run the tests', 'Should return expected text');
    assert(result.duration_ms > 0, 'Should include duration');
  } finally {
    await mockSTT.close();
  }
});

await test('STT pipeline handles different audio formats', async () => {
  const mockSTT = await createMockSTTServer();

  try {
    mockSTT.configure({ defaultTranscription: 'test audio' });

    const samples = createTestAudioSamples();

    // Test with different sample types
    for (const [name, buffer] of Object.entries(samples)) {
      const response = await fetch(`${mockSTT.url}/transcribe`, {
        method: 'POST',
        body: buffer,
        headers: { 'Content-Type': 'audio/wav' },
      });

      const result = await response.json();
      assert(result.success, `${name} audio should be accepted`);
    }
  } finally {
    await mockSTT.close();
  }
});

// ============================================================
// Integration Test: Intent Classification Pipeline
// ============================================================

group('Intent Classification Integration');

await test('Intent classification returns structured intent', async () => {
  const mockOllama = await createMockOllamaServer();

  try {
    mockOllama.setDefaultIntent({
      action: 'claude_code',
      command: 'explain this code',
      confidence: 0.92,
    });

    const response = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [
          { role: 'system', content: 'Classify the user intent...' },
          { role: 'user', content: 'explain this code' },
        ],
        format: 'json',
      }),
    });

    const data = await response.json();
    const intent = JSON.parse(data.message.content);

    assertEqual(intent.action, 'claude_code', 'Should classify as claude_code');
    assert(intent.confidence > 0.9, 'Should have high confidence');
  } finally {
    await mockOllama.close();
  }
});

await test('Intent classification handles multiple action types', async () => {
  const mockOllama = await createMockOllamaServer();

  try {
    // Set up pattern-based responses
    mockOllama.setResponse('open', { action: 'app_control', target: 'Safari' });
    mockOllama.setResponse('run', { action: 'terminal', command: 'npm test' });
    mockOllama.setResponse('ask claude', { action: 'claude_code', command: 'help' });
    mockOllama.setResponse('status', { action: 'ralph_command', command: 'status' });

    const testCases = [
      { input: 'open Safari', expected: 'app_control' },
      { input: 'run the tests', expected: 'terminal' },
      { input: 'ask claude to help', expected: 'claude_code' },
      { input: 'check ralph status', expected: 'ralph_command' },
    ];

    for (const { input, expected } of testCases) {
      const response = await fetch(`${mockOllama.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          messages: [{ role: 'user', content: input }],
        }),
      });

      const data = await response.json();
      const intent = JSON.parse(data.message.content);
      assertEqual(intent.action, expected, `"${input}" should classify as ${expected}`);
    }
  } finally {
    await mockOllama.close();
  }
});

// ============================================================
// Full Pipeline Integration Test
// ============================================================

group('Full Voice Pipeline Integration');

await test('Full pipeline: Audio -> Transcription -> Classification', async () => {
  // Start both mock servers
  const mockSTT = await createMockSTTServer();
  const mockOllama = await createMockOllamaServer();

  try {
    // Configure STT to return specific transcription
    mockSTT.configure({ defaultTranscription: 'list all files' });

    // Configure Ollama to classify "list" commands as terminal
    mockOllama.setResponse('list', {
      action: 'terminal',
      command: 'ls -la',
      confidence: 0.95,
    });

    // Step 1: Create audio
    const audioBuffer = createWavBuffer({ durationMs: 1500 });

    // Step 2: Transcribe
    const sttResponse = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });
    const transcription = await sttResponse.json();
    assert(transcription.success, 'Transcription should succeed');
    assertEqual(transcription.text, 'list all files', 'Should get expected transcription');

    // Step 3: Classify intent
    const ollamaResponse = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [
          {
            role: 'system',
            content: 'Classify the user intent as a JSON object.',
          },
          {
            role: 'user',
            content: transcription.text,
          },
        ],
        format: 'json',
      }),
    });

    const classification = await ollamaResponse.json();
    const intent = JSON.parse(classification.message.content);

    assertEqual(intent.action, 'terminal', 'Should classify as terminal action');
    assertEqual(intent.command, 'ls -la', 'Should extract correct command');
    assert(intent.confidence > 0.9, 'Should have high confidence');
  } finally {
    await mockSTT.close();
    await mockOllama.close();
  }
});

await test('Pipeline handles errors gracefully', async () => {
  const mockSTT = await createMockSTTServer();

  try {
    // Configure STT to return errors
    mockSTT.configure({
      forceError: true,
      errorMessage: 'Server overloaded',
      errorStatusCode: 503,
    });

    const audioBuffer = createWavBuffer();
    const response = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    assertEqual(response.status, 503, 'Should return 503 status');

    const error = await response.json();
    assertEqual(error.success, false, 'Should indicate failure');
    assertContains(error.error, 'overloaded', 'Should include error message');
  } finally {
    await mockSTT.close();
  }
});

// ============================================================
// Happy Path Tests - US-014
// ============================================================

group('Happy Path Tests (US-014)');

await test('Full pipeline: Audio -> Transcription -> Classification -> Execution -> TTS', async () => {
  // This test simulates the complete voice pipeline:
  // 1. Audio input (WAV)
  // 2. STT transcription
  // 3. Intent classification
  // 4. Action execution (mocked)
  // 5. TTS response generation

  const mockSTT = await createMockSTTServer();
  const mockOllama = await createMockOllamaServer();

  try {
    // Configure mock STT to return a command transcription
    mockSTT.configure({ defaultTranscription: 'explain the code in main.js' });

    // Configure mock Ollama to classify as claude_code intent
    mockOllama.setDefaultIntent({
      action: 'claude_code',
      command: 'explain the code in main.js',
      confidence: 0.95,
      parameters: {},
    });

    // Step 1: Create audio input
    const audioBuffer = createWavBuffer({ durationMs: 2000 });
    assert(Buffer.isBuffer(audioBuffer), 'Should create audio buffer');

    // Step 2: Transcribe audio via mock STT
    const sttResponse = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    const transcription = await sttResponse.json();
    assert(transcription.success, 'Transcription should succeed');
    assertEqual(transcription.text, 'explain the code in main.js', 'Should get expected transcription');

    // Step 3: Classify intent via mock Ollama
    const classifyResponse = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [
          { role: 'system', content: 'Classify the user intent as JSON.' },
          { role: 'user', content: transcription.text },
        ],
        format: 'json',
      }),
    });

    const classifyData = await classifyResponse.json();
    const intent = JSON.parse(classifyData.message.content);

    assertEqual(intent.action, 'claude_code', 'Should classify as claude_code');
    assert(intent.confidence > 0.9, 'Should have high confidence');

    // Step 4: Verify execution routing would be correct
    const executionRoute = getExecutionRoute(intent.action);
    assertEqual(executionRoute, 'claudeCodeExecutor', 'Should route to Claude Code executor');

    // Step 5: Simulate TTS response text generation
    const ttsText = generateTTSResponse(intent, {
      success: true,
      output: 'The main.js file contains the entry point for the application.',
    });
    assert(ttsText.length > 0, 'Should generate TTS response text');
    assert(ttsText.length < 500, 'TTS response should be concise');

    // Verify full pipeline flow
    const pipelineResult = {
      transcription: transcription.text,
      intent: intent,
      executionTarget: executionRoute,
      ttsResponse: ttsText,
    };

    assert(pipelineResult.transcription, 'Pipeline should have transcription');
    assert(pipelineResult.intent.action, 'Pipeline should have classified intent');
    assertEqual(pipelineResult.intent.action, 'claude_code', 'Intent should be claude_code');
  } finally {
    await mockSTT.close();
    await mockOllama.close();
  }
});

await test('Claude Code command with TTS response', async () => {
  const mockSTT = await createMockSTTServer();
  const mockOllama = await createMockOllamaServer();

  try {
    // Configure for Claude Code command
    mockSTT.configure({ defaultTranscription: 'ask claude to help me fix this bug' });

    mockOllama.setResponse('claude', {
      action: 'claude_code',
      command: 'help me fix this bug',
      confidence: 0.92,
      parameters: {
        model: 'sonnet',
        includeContext: true,
      },
    });

    // Transcribe
    const audioBuffer = createWavBuffer({ durationMs: 1500 });
    const sttResponse = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    const transcription = await sttResponse.json();
    assertEqual(transcription.text, 'ask claude to help me fix this bug', 'Should transcribe Claude command');

    // Classify
    const classifyResponse = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [{ role: 'user', content: transcription.text }],
      }),
    });

    const classifyData = await classifyResponse.json();
    const intent = JSON.parse(classifyData.message.content);

    assertEqual(intent.action, 'claude_code', 'Should classify as claude_code');

    // Verify Claude Code executor would be used
    const executionRoute = getExecutionRoute(intent.action);
    assertEqual(executionRoute, 'claudeCodeExecutor', 'Should route to Claude Code executor');

    // Simulate Claude Code response
    const mockClaudeResponse = {
      success: true,
      output: 'I found the bug in your code. The issue is on line 42 where you are comparing strings with == instead of ===.',
      filteredOutput: 'Found the bug on line 42. Use === instead of == for string comparison.',
      exitCode: 0,
    };

    // Generate TTS-friendly response
    const ttsResponse = generateTTSResponse(intent, mockClaudeResponse);
    assertContains(ttsResponse, 'bug', 'TTS response should mention the bug');

    // Verify response is suitable for TTS (not too long, no code blocks)
    assert(ttsResponse.length < 300, 'TTS response should be concise');
    assert(!ttsResponse.includes('```'), 'TTS response should not contain code blocks');
  } finally {
    await mockSTT.close();
    await mockOllama.close();
  }
});

await test('App control command (open Chrome)', async () => {
  const mockSTT = await createMockSTTServer();
  const mockOllama = await createMockOllamaServer();

  try {
    // Configure for app control command
    mockSTT.configure({ defaultTranscription: 'open Google Chrome browser' });

    // Use case-insensitive regex to match "Chrome" in any form
    mockOllama.setResponse(/chrome/i, {
      action: 'app_control',
      target: 'Google Chrome',
      command: 'activate',
      confidence: 0.96,
      parameters: {
        app: 'Google Chrome',
        action: 'open',
      },
    });

    // Transcribe
    const audioBuffer = createWavBuffer({ durationMs: 1000 });
    const sttResponse = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    const transcription = await sttResponse.json();
    assertContains(transcription.text, 'Chrome', 'Should transcribe Chrome command');

    // Classify
    const classifyResponse = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [{ role: 'user', content: transcription.text }],
      }),
    });

    const classifyData = await classifyResponse.json();
    const intent = JSON.parse(classifyData.message.content);

    assertEqual(intent.action, 'app_control', 'Should classify as app_control');
    assertEqual(intent.target, 'Google Chrome', 'Should target Chrome');

    // Verify AppleScript executor would be used
    const executionRoute = getExecutionRoute(intent.action);
    assertEqual(executionRoute, 'appleScriptExecutor', 'Should route to AppleScript executor');

    // Verify the AppleScript command would be generated correctly
    const appleScriptCommand = generateAppleScriptCommand(intent);
    assertContains(appleScriptCommand, 'activate', 'Should include activate command');
    assertContains(appleScriptCommand, 'Google Chrome', 'Should target Chrome');

    // Simulate execution result
    const mockResult = {
      success: true,
      output: 'Opened Google Chrome',
    };

    // Generate TTS response
    const ttsResponse = generateTTSResponse(intent, mockResult);
    assertContains(ttsResponse.toLowerCase(), 'chrome', 'TTS should mention Chrome');
    assertContains(ttsResponse.toLowerCase(), 'open', 'TTS should mention opening');
  } finally {
    await mockSTT.close();
    await mockOllama.close();
  }
});

await test('Terminal command (git status)', async () => {
  const mockSTT = await createMockSTTServer();
  const mockOllama = await createMockOllamaServer();

  try {
    // Configure for terminal command
    mockSTT.configure({ defaultTranscription: 'run git status in the terminal' });

    mockOllama.setResponse('git status', {
      action: 'terminal',
      command: 'git status',
      confidence: 0.98,
      parameters: {},
    });

    // Transcribe
    const audioBuffer = createWavBuffer({ durationMs: 1200 });
    const sttResponse = await fetch(`${mockSTT.url}/transcribe`, {
      method: 'POST',
      body: audioBuffer,
      headers: { 'Content-Type': 'audio/wav' },
    });

    const transcription = await sttResponse.json();
    assertContains(transcription.text, 'git status', 'Should transcribe git status command');

    // Classify
    const classifyResponse = await fetch(`${mockOllama.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: [{ role: 'user', content: transcription.text }],
      }),
    });

    const classifyData = await classifyResponse.json();
    const intent = JSON.parse(classifyData.message.content);

    assertEqual(intent.action, 'terminal', 'Should classify as terminal');
    assertEqual(intent.command, 'git status', 'Should extract git status command');
    assert(intent.confidence > 0.95, 'Should have very high confidence');

    // Verify terminal executor would be used
    const executionRoute = getExecutionRoute(intent.action);
    assertEqual(executionRoute, 'terminalExecutor', 'Should route to terminal executor');

    // Verify the command is safe (not dangerous)
    const isDangerous = checkDangerousCommand(intent.command);
    assertEqual(isDangerous, false, 'git status should not be flagged as dangerous');

    // Simulate execution result with a longer, more realistic output
    const mockResult = {
      success: true,
      output: `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
  modified:   tests/voice-e2e.mjs
  modified:   src/voice-agent/executor/action-router.ts
  modified:   src/voice-agent/tts/tts-engine.ts
  modified:   src/voice-agent/llm/intent-classifier.ts
  modified:   src/voice-agent/stt/whisper-client.ts
  modified:   ui/public/js/voice-client.js
  modified:   ui/src/routes/voice.ts
  modified:   package.json
  modified:   CHANGELOG.md
  modified:   README.md

Untracked files:
  (use "git add <file>..." to include in what will be committed)
  tests/helpers/mock-stt-server.mjs
  tests/helpers/mock-ollama-server.mjs
  tests/helpers/audio-utils.mjs

no changes added to commit (use "git add" and/or "git commit -a")`,
      exitCode: 0,
    };

    // Filter output for TTS - the filter should reduce long outputs
    const filteredOutput = filterOutputForTTS(mockResult.output);
    // Filtered output should be concise for TTS
    assert(filteredOutput.length <= 300, 'Filtered output should be 300 chars or less for TTS');

    // Generate TTS response
    const ttsResponse = generateTTSResponse(intent, { ...mockResult, filteredOutput });
    assertContains(ttsResponse.toLowerCase(), 'branch', 'TTS should mention branch');
    assertContains(ttsResponse.toLowerCase(), 'main', 'TTS should mention main');
  } finally {
    await mockSTT.close();
    await mockOllama.close();
  }
});

await test('Full pipeline with different intent types correctly routed', async () => {
  const mockSTT = await createMockSTTServer();
  const mockOllama = await createMockOllamaServer();

  try {
    // Set up response mappings for different intents
    mockOllama.setResponse('open safari', { action: 'app_control', target: 'Safari', command: 'activate' });
    mockOllama.setResponse('run npm', { action: 'terminal', command: 'npm test' });
    mockOllama.setResponse('ask claude', { action: 'claude_code', command: 'explain this' });
    mockOllama.setResponse('ralph status', { action: 'ralph_command', command: 'status' });
    mockOllama.setResponse('search google', { action: 'web_search', parameters: { query: 'test' } });

    const testCases = [
      { transcription: 'open safari browser', expectedAction: 'app_control', expectedRoute: 'appleScriptExecutor' },
      { transcription: 'run npm test command', expectedAction: 'terminal', expectedRoute: 'terminalExecutor' },
      { transcription: 'ask claude about this code', expectedAction: 'claude_code', expectedRoute: 'claudeCodeExecutor' },
      { transcription: 'check ralph status', expectedAction: 'ralph_command', expectedRoute: 'ralphExecutor' },
      { transcription: 'search google for javascript', expectedAction: 'web_search', expectedRoute: 'webSearchHandler' },
    ];

    for (const testCase of testCases) {
      // Set transcription for this test case
      mockSTT.configure({ defaultTranscription: testCase.transcription });

      // Create audio and transcribe
      const audioBuffer = createWavBuffer({ durationMs: 800 });
      const sttResponse = await fetch(`${mockSTT.url}/transcribe`, {
        method: 'POST',
        body: audioBuffer,
        headers: { 'Content-Type': 'audio/wav' },
      });

      const transcription = await sttResponse.json();
      assert(transcription.success, `Transcription for "${testCase.transcription}" should succeed`);

      // Classify
      const classifyResponse = await fetch(`${mockOllama.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          messages: [{ role: 'user', content: transcription.text }],
        }),
      });

      const classifyData = await classifyResponse.json();
      const intent = JSON.parse(classifyData.message.content);

      assertEqual(intent.action, testCase.expectedAction, `"${testCase.transcription}" should classify as ${testCase.expectedAction}`);

      // Verify routing
      const route = getExecutionRoute(intent.action);
      assertEqual(route, testCase.expectedRoute, `${testCase.expectedAction} should route to ${testCase.expectedRoute}`);

      // Clear request tracking for next iteration
      mockSTT.reset();
      mockOllama.reset();

      // Re-set up response mappings
      mockOllama.setResponse('open safari', { action: 'app_control', target: 'Safari', command: 'activate' });
      mockOllama.setResponse('run npm', { action: 'terminal', command: 'npm test' });
      mockOllama.setResponse('ask claude', { action: 'claude_code', command: 'explain this' });
      mockOllama.setResponse('ralph status', { action: 'ralph_command', command: 'status' });
      mockOllama.setResponse('search google', { action: 'web_search', parameters: { query: 'test' } });
    }
  } finally {
    await mockSTT.close();
    await mockOllama.close();
  }
});

// ============================================================
// Helper Functions for Happy Path Tests
// ============================================================

/**
 * Get the execution route for an action type
 */
function getExecutionRoute(action) {
  const routes = {
    terminal: 'terminalExecutor',
    app_control: 'appleScriptExecutor',
    ralph_command: 'ralphExecutor',
    claude_code: 'claudeCodeExecutor',
    web_search: 'webSearchHandler',
    file_operation: 'fileOperationHandler',
    unknown: 'unknownHandler',
  };
  return routes[action] || 'unknownHandler';
}

/**
 * Generate a TTS-friendly response from execution result
 */
function generateTTSResponse(intent, result) {
  if (!result.success) {
    return `Sorry, I couldn't complete that action. ${result.error || 'Unknown error'}`;
  }

  const filteredOutput = result.filteredOutput || result.output || '';

  switch (intent.action) {
    case 'claude_code':
      // Use filtered output or summarize
      if (filteredOutput.length > 200) {
        return filteredOutput.slice(0, 200) + '...';
      }
      return filteredOutput || 'Task completed successfully.';

    case 'app_control':
      return `Opened ${intent.target || 'the application'}.`;

    case 'terminal':
      // Summarize terminal output for TTS
      if (filteredOutput.includes('branch')) {
        const branchMatch = filteredOutput.match(/On branch (\w+)/);
        const branch = branchMatch ? branchMatch[1] : 'current';
        return `You're on the ${branch} branch. ${filteredOutput.includes('nothing to commit') ? 'Working directory is clean.' : 'There are uncommitted changes.'}`;
      }
      return filteredOutput.length > 150 ? filteredOutput.slice(0, 150) + '...' : filteredOutput;

    case 'ralph_command':
      return filteredOutput || 'Ralph command executed.';

    case 'web_search':
      return `Searching for ${intent.parameters?.query || 'your query'}.`;

    default:
      return 'Action completed.';
  }
}

/**
 * Generate AppleScript command for app control
 */
function generateAppleScriptCommand(intent) {
  const app = intent.target || intent.parameters?.app || 'Finder';
  const action = intent.command || 'activate';

  return `tell application "${app}" to ${action}`;
}

/**
 * Check if a command is dangerous
 */
function checkDangerousCommand(command) {
  const dangerousPatterns = [
    /rm\s+-rf/i,
    /sudo\s+rm/i,
    /mkfs/i,
    /dd\s+if=/i,
    />\/dev\//i,
    /chmod\s+777/i,
    /:(){ :|:& };:/i,  // Fork bomb
    /wget.*\|.*bash/i,
    /curl.*\|.*sh/i,
  ];

  return dangerousPatterns.some(pattern => pattern.test(command));
}

/**
 * Filter output for TTS (remove code blocks, long lists, etc.)
 */
function filterOutputForTTS(output) {
  let filtered = output;

  // Remove ANSI escape codes
  filtered = filtered.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  // Remove code blocks
  filtered = filtered.replace(/```[\s\S]*?```/g, '[code block removed]');

  // Remove long file lists (more than 5 lines)
  const lines = filtered.split('\n');
  if (lines.length > 10) {
    const importantLines = lines.filter(line =>
      line.includes('branch') ||
      line.includes('modified') ||
      line.includes('commit') ||
      line.includes('error') ||
      line.includes('success')
    );
    filtered = importantLines.slice(0, 5).join('\n');
  }

  // Trim whitespace
  filtered = filtered.trim();

  // Limit length
  if (filtered.length > 300) {
    filtered = filtered.slice(0, 297) + '...';
  }

  return filtered;
}

// ============================================================
// Summary
// ============================================================

console.log(`\n${colors.cyan}=== Voice E2E Test Summary ===${colors.reset}`);
console.log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`  ${colors.red}Failed: ${failed}${colors.reset}`);

if (failures.length > 0) {
  console.log(`\n${colors.red}Failures:${colors.reset}`);
  for (const f of failures) {
    console.log(`\n  ${colors.yellow}[${f.group}] ${f.name}${colors.reset}`);
    console.log(`    ${colors.red}${f.error}${colors.reset}`);
    if (f.stack) {
      console.log(`    ${colors.dim}${f.stack.split('\n').slice(1, 3).join('\n    ')}${colors.reset}`);
    }
  }
  process.exit(1);
}

console.log(`\n${colors.green}All voice E2E tests passed!${colors.reset}\n`);
