/**
 * Voice Agent API Routes
 *
 * HTTP and SSE endpoints for the voice-controlled automation system.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  voiceProcessManager,
  type VoiceEvent,
} from "../voice-agent/process/voice-process-manager.js";
import { createWhisperClient } from "../voice-agent/stt/whisper-client.js";
import { createIntentClassifier } from "../voice-agent/llm/intent-classifier.js";
import { createActionRouter } from "../voice-agent/executor/action-router.js";
import type { VoiceIntent, TranscriptionResult } from "../voice-agent/types.js";
import {
  analyzeTranscriptionForWakeWord,
  type WakeWordResult,
} from "../voice-agent/wake-word/wake-word-detector.js";

export const voice = new Hono();

// Create clients
const whisperClient = createWhisperClient();
const intentClassifier = createIntentClassifier();
const actionRouter = createActionRouter();

/**
 * GET /voice/health
 * Check voice agent services health
 */
voice.get("/health", async (c) => {
  const services = await voiceProcessManager.checkServices();
  const sttStatus = voiceProcessManager.getSTTServerStatus();

  return c.json({
    healthy: services.sttServer && services.ollama,
    services: {
      sttServer: {
        healthy: services.sttServer,
        ...sttStatus,
      },
      ollama: {
        healthy: services.ollama,
      },
    },
    messages: services.messages,
    config: voiceProcessManager.getConfig(),
  });
});

/**
 * POST /voice/stt/start
 * Start the Whisper STT server
 */
voice.post("/stt/start", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { port, model, preload } = body;

  const result = await voiceProcessManager.startSTTServer({
    port,
    model,
    preload,
  });

  if (result.success) {
    return c.json(result);
  } else {
    return c.json(result, 400);
  }
});

/**
 * POST /voice/stt/stop
 * Stop the Whisper STT server
 */
voice.post("/stt/stop", async (c) => {
  const result = voiceProcessManager.stopSTTServer();

  if (result.success) {
    return c.json(result);
  } else {
    return c.json(result, 400);
  }
});

/**
 * GET /voice/stt/status
 * Get STT server status
 */
voice.get("/stt/status", (c) => {
  return c.json(voiceProcessManager.getSTTServerStatus());
});

/**
 * POST /voice/transcribe
 * Transcribe audio to text
 *
 * Accepts audio data as multipart form data or raw binary.
 * Proxies to the Whisper STT server.
 */
voice.post("/transcribe", async (c) => {
  try {
    const contentType = c.req.header("content-type") || "";

    let audioData: ArrayBuffer;
    let language: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      // Handle multipart form data
      const formData = await c.req.formData();
      const file = formData.get("file");
      language = formData.get("language")?.toString();

      if (!file || !(file instanceof File)) {
        return c.json(
          {
            success: false,
            error: "No audio file provided",
          },
          400
        );
      }

      audioData = await file.arrayBuffer();
    } else {
      // Handle raw binary data
      audioData = await c.req.arrayBuffer();
      language = c.req.query("language");
    }

    if (audioData.byteLength < 100) {
      return c.json(
        {
          success: false,
          error: "Audio data too small",
        },
        400
      );
    }

    // Update Whisper client language if provided
    if (language) {
      whisperClient.setLanguage(language);
    }

    // Transcribe via Whisper client
    const result = await whisperClient.transcribe(Buffer.from(audioData), {
      language,
    });

    return c.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        success: false,
        error: `Transcription failed: ${errorMessage}`,
      },
      500
    );
  }
});

// ============================================
// Wake Word Detection Endpoint
// ============================================

/**
 * POST /voice/wake-word
 * Detect wake word ("Hey Claude") in audio stream
 *
 * Accepts audio data and transcribes it using Whisper STT in streaming mode,
 * then checks if the transcription contains the wake phrase.
 * Designed for low-latency detection (< 500ms target).
 */
voice.post("/wake-word", async (c) => {
  const startTime = Date.now();

  try {
    const contentType = c.req.header("content-type") || "";

    let audioData: ArrayBuffer;

    if (contentType.includes("multipart/form-data")) {
      // Handle multipart form data
      const formData = await c.req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return c.json(
          {
            detected: false,
            error: "No audio file provided",
            duration_ms: Date.now() - startTime,
          },
          400
        );
      }

      audioData = await file.arrayBuffer();
    } else {
      // Handle raw binary data
      audioData = await c.req.arrayBuffer();
    }

    // Validate audio data - wake word detection needs short clips
    // Minimum size check to ensure we have actual audio
    if (audioData.byteLength < 100) {
      return c.json(
        {
          detected: false,
          error: "Audio data too small",
          duration_ms: Date.now() - startTime,
        },
        400
      );
    }

    // Maximum size check - wake word audio should be short (< 5 seconds typically)
    // This helps ensure fast processing. 5 seconds of 16kHz mono audio ≈ 160KB
    const maxSize = 500 * 1024; // 500KB max to ensure fast processing
    if (audioData.byteLength > maxSize) {
      return c.json(
        {
          detected: false,
          error: "Audio data too large for wake word detection",
          duration_ms: Date.now() - startTime,
        },
        400
      );
    }

    // Transcribe the audio using Whisper STT
    // For wake word detection, we don't need full transcription - just check for the phrase
    const transcriptionResult = await whisperClient.transcribe(
      Buffer.from(audioData),
      {
        language: "en", // Wake word is English
      }
    );

    const transcriptionTime = Date.now() - startTime;

    if (!transcriptionResult.success) {
      return c.json({
        detected: false,
        error: transcriptionResult.error || "Transcription failed",
        duration_ms: transcriptionTime,
      });
    }

    // Analyze transcription for wake phrase
    const wakeWordResult = analyzeTranscriptionForWakeWord(
      transcriptionResult.text
    );

    const totalTime = Date.now() - startTime;

    // Return wake word detection result
    const response: WakeWordResult & {
      transcription?: string;
      transcription_duration_ms?: number;
    } = {
      detected: wakeWordResult.detected,
      confidence: wakeWordResult.confidence,
      phrase: wakeWordResult.phrase,
      duration_ms: totalTime,
    };

    // Include transcription for debugging (optional, only in non-production)
    if (process.env.NODE_ENV !== "production") {
      response.transcription = transcriptionResult.text;
      response.transcription_duration_ms = transcriptionTime;
    }

    return c.json(response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        detected: false,
        error: `Wake word detection failed: ${errorMessage}`,
        duration_ms: Date.now() - startTime,
      },
      500
    );
  }
});

/**
 * GET /voice/wake-word/status
 * Check if wake word detection service is available
 */
voice.get("/wake-word/status", async (c) => {
  try {
    // Check if STT server is healthy
    const sttHealth = await whisperClient.checkHealth();

    return c.json({
      available: sttHealth.healthy,
      sttServer: {
        healthy: sttHealth.healthy,
        model: sttHealth.model,
        modelLoaded: sttHealth.modelLoaded,
      },
      message: sttHealth.healthy
        ? "Wake word detection service is available"
        : "STT server not available, use client-side detection",
    });
  } catch (error) {
    return c.json({
      available: false,
      error: "Failed to check wake word service status",
      message: "Use client-side detection as fallback",
    });
  }
});

/**
 * POST /voice/session
 * Create a new voice session
 */
voice.post("/session", (c) => {
  const { session, eventEmitter } = voiceProcessManager.createSession();

  return c.json({
    success: true,
    sessionId: session.id,
    state: session.state,
    sseUrl: `/api/voice/session/${session.id}/events`,
  });
});

/**
 * GET /voice/session/:sessionId
 * Get session info
 */
voice.get("/session/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const session = voiceProcessManager.getSession(sessionId);

  if (!session) {
    return c.json(
      {
        success: false,
        error: "Session not found",
      },
      404
    );
  }

  return c.json({
    success: true,
    session,
  });
});

/**
 * DELETE /voice/session/:sessionId
 * Close a voice session
 */
voice.delete("/session/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const session = voiceProcessManager.getSession(sessionId);

  if (!session) {
    return c.json(
      {
        success: false,
        error: "Session not found",
      },
      404
    );
  }

  voiceProcessManager.closeSession(sessionId);

  return c.json({
    success: true,
    message: "Session closed",
  });
});

/**
 * GET /voice/session/:sessionId/events
 * SSE stream for session events
 */
voice.get("/session/:sessionId/events", async (c) => {
  const sessionId = c.req.param("sessionId");
  const eventEmitter = voiceProcessManager.getEventEmitter(sessionId);

  if (!eventEmitter) {
    return c.json(
      {
        success: false,
        error: "Session not found",
      },
      404
    );
  }

  return streamSSE(c, async (stream) => {
    // Send initial connection event
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({
        sessionId,
        timestamp: new Date().toISOString(),
      }),
    });

    // Set up event listener
    const onEvent = async (event: VoiceEvent) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify({
            sessionId: event.sessionId,
            data: event.data,
            timestamp: event.timestamp.toISOString(),
          }),
        });
      } catch {
        // Stream closed, ignore
      }
    };

    eventEmitter.on("event", onEvent);

    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    // Clean up on close
    stream.onAbort(() => {
      clearInterval(heartbeatInterval);
      eventEmitter.off("event", onEvent);
    });

    // Keep stream open
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (stream.aborted) break;
    }
  });
});

/**
 * POST /voice/session/:sessionId/state
 * Update session state
 */
voice.post("/session/:sessionId/state", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = voiceProcessManager.getSession(sessionId);

  if (!session) {
    return c.json(
      {
        success: false,
        error: "Session not found",
      },
      404
    );
  }

  const body = await c.req.json();
  const { state } = body;

  if (!state) {
    return c.json(
      {
        success: false,
        error: "State is required",
      },
      400
    );
  }

  voiceProcessManager.updateSessionState(sessionId, state);

  return c.json({
    success: true,
    state,
  });
});

/**
 * POST /voice/session/:sessionId/confirm
 * Confirm a pending action
 */
voice.post("/session/:sessionId/confirm", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = voiceProcessManager.getSession(sessionId);

  if (!session) {
    return c.json(
      {
        success: false,
        error: "Session not found",
      },
      404
    );
  }

  if (!session.pendingIntent) {
    return c.json(
      {
        success: false,
        error: "No pending action to confirm",
      },
      400
    );
  }

  const intent = session.pendingIntent;
  voiceProcessManager.clearPendingIntent(sessionId);
  voiceProcessManager.updateSessionState(sessionId, "executing");

  // Emit confirmation event
  voiceProcessManager.emitEvent(sessionId, "execution_start", {
    intent,
    confirmed: true,
  });

  return c.json({
    success: true,
    message: "Action confirmed",
    intent,
  });
});

/**
 * POST /voice/session/:sessionId/reject
 * Reject a pending action
 */
voice.post("/session/:sessionId/reject", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = voiceProcessManager.getSession(sessionId);

  if (!session) {
    return c.json(
      {
        success: false,
        error: "Session not found",
      },
      404
    );
  }

  if (!session.pendingIntent) {
    return c.json(
      {
        success: false,
        error: "No pending action to reject",
      },
      400
    );
  }

  voiceProcessManager.clearPendingIntent(sessionId);
  voiceProcessManager.updateSessionState(sessionId, "idle");

  return c.json({
    success: true,
    message: "Action rejected",
  });
});

/**
 * GET /voice/sessions
 * List all active sessions
 */
voice.get("/sessions", (c) => {
  const sessionIds = voiceProcessManager.getActiveSessions();
  const sessions = sessionIds
    .map((id) => voiceProcessManager.getSession(id))
    .filter((s) => s !== null);

  return c.json({
    success: true,
    count: sessions.length,
    sessions,
  });
});

/**
 * GET /voice/config
 * Get voice agent configuration
 */
voice.get("/config", (c) => {
  return c.json({
    success: true,
    config: voiceProcessManager.getConfig(),
  });
});

/**
 * PATCH /voice/config
 * Update voice agent configuration
 */
voice.patch("/config", async (c) => {
  const updates = await c.req.json();
  voiceProcessManager.updateConfig(updates);

  return c.json({
    success: true,
    config: voiceProcessManager.getConfig(),
  });
});

/**
 * POST /voice/classify
 * Classify text into an intent (for testing)
 */
voice.post("/classify", async (c) => {
  try {
    const body = await c.req.json();
    const { text } = body;

    if (!text || typeof text !== "string") {
      return c.json(
        {
          success: false,
          error: "Text is required",
        },
        400
      );
    }

    const result = await intentClassifier.classifyWithFallback(text);

    return c.json({
      success: result.success,
      intent: result.intent,
      raw: result.raw,
      error: result.error,
      duration_ms: result.duration_ms,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        success: false,
        error: `Classification failed: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * POST /voice/execute
 * Execute an intent directly (for testing)
 */
voice.post("/execute", async (c) => {
  try {
    const body = await c.req.json();
    const { intent, autoExecute } = body;

    if (!intent) {
      return c.json(
        {
          success: false,
          error: "Intent is required",
        },
        400
      );
    }

    // Check if confirmation is required
    if (actionRouter.requiresConfirmation(intent) && !autoExecute) {
      return c.json({
        success: false,
        requiresConfirmation: true,
        intent,
        message: "This action requires confirmation. Set autoExecute: true to proceed.",
      });
    }

    const result = await actionRouter.execute(intent);

    return c.json({
      success: result.success,
      output: result.output,
      error: result.error,
      exitCode: result.exitCode,
      duration_ms: result.duration_ms,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        success: false,
        error: `Execution failed: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * POST /voice/process
 * Process text through full pipeline (classify + execute)
 */
voice.post("/process", async (c) => {
  try {
    const body = await c.req.json();
    const { text, autoExecute } = body;

    if (!text || typeof text !== "string") {
      return c.json(
        {
          success: false,
          error: "Text is required",
        },
        400
      );
    }

    const result = await actionRouter.processText(text, {
      autoExecute: autoExecute || false,
    });

    return c.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        success: false,
        error: `Processing failed: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * GET /voice/services
 * Check all service availability (detailed)
 */
voice.get("/services", async (c) => {
  const services = await actionRouter.checkServices();

  return c.json({
    success: true,
    services: {
      stt: services.stt,
      llm: services.llm,
      appleScript: services.appleScript,
      ralph: services.ralph,
      claudeCode: services.claudeCode,
      tts: services.tts,
      openInterpreter: services.openInterpreter,
    },
    messages: services.messages,
    allHealthy: services.stt && services.llm,
  });
});

/**
 * GET /voice/ralph/status
 * Get Ralph PRD status (for voice queries like "what's the status?")
 */
voice.get("/ralph/status", async (c) => {
  const prdNumber = c.req.query("prd");
  const queryType = c.req.query("type") || "overall";

  const result = await actionRouter.getStatus({
    prdNumber,
    queryType,
  });

  return c.json(result);
});

/**
 * GET /voice/context
 * Get current conversation context summary
 */
voice.get("/context", (c) => {
  const summary = actionRouter.getConversationSummary();
  return c.json({
    success: true,
    context: summary,
  });
});

/**
 * DELETE /voice/context
 * Clear conversation context
 */
voice.delete("/context", (c) => {
  actionRouter.clearConversationContext();
  return c.json({
    success: true,
    message: "Conversation context cleared",
  });
});

/**
 * POST /voice/context/prd
 * Set current PRD in conversation context
 */
voice.post("/context/prd", async (c) => {
  const body = await c.req.json();
  const { prdNumber } = body;

  if (!prdNumber) {
    return c.json({
      success: false,
      error: "prdNumber is required",
    }, 400);
  }

  actionRouter.setCurrentPrd(prdNumber.toString());
  return c.json({
    success: true,
    message: `Current PRD set to ${prdNumber}`,
    context: actionRouter.getConversationSummary(),
  });
});

// ============================================
// TTS (Text-to-Speech) Endpoints
// ============================================

/**
 * GET /voice/tts/status
 * Get TTS status
 */
voice.get("/tts/status", async (c) => {
  return c.json({
    success: true,
    enabled: actionRouter.isTTSEnabled(),
    speaking: actionRouter.isTTSSpeaking(),
  });
});

/**
 * POST /voice/tts/speak
 * Speak text via TTS
 */
voice.post("/tts/speak", async (c) => {
  try {
    const body = await c.req.json();
    const { text } = body;

    if (!text || typeof text !== "string") {
      return c.json(
        {
          success: false,
          error: "Text is required",
        },
        400
      );
    }

    const result = await actionRouter.speak(text);
    return c.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        success: false,
        error: `TTS failed: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * POST /voice/tts/stop
 * Stop current TTS playback
 */
voice.post("/tts/stop", (c) => {
  actionRouter.stopTTS();
  return c.json({
    success: true,
    message: "TTS stopped",
  });
});

/**
 * POST /voice/tts/enable
 * Enable TTS
 */
voice.post("/tts/enable", (c) => {
  actionRouter.setTTSEnabled(true);
  return c.json({
    success: true,
    enabled: true,
  });
});

/**
 * POST /voice/tts/disable
 * Disable TTS
 */
voice.post("/tts/disable", (c) => {
  actionRouter.setTTSEnabled(false);
  return c.json({
    success: true,
    enabled: false,
  });
});

/**
 * GET /voice/tts/voices
 * Get available TTS voices
 */
voice.get("/tts/voices", async (c) => {
  const voices = await actionRouter.getTTSVoices();
  const currentVoice = actionRouter.getTTSVoice();
  return c.json({
    success: true,
    voices,
    currentVoice,
  });
});

/**
 * GET /voice/tts/voice
 * Get current TTS voice
 */
voice.get("/tts/voice", (c) => {
  return c.json({
    success: true,
    voice: actionRouter.getTTSVoice(),
  });
});

/**
 * POST /voice/tts/voice
 * Set TTS voice
 */
voice.post("/tts/voice", async (c) => {
  try {
    const body = await c.req.json();
    const { voice: voiceName } = body;

    if (!voiceName) {
      return c.json({ success: false, error: "Voice name required" }, 400);
    }

    actionRouter.setTTSVoice(voiceName);

    return c.json({
      success: true,
      voice: actionRouter.getTTSVoice(),
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to set voice",
    }, 500);
  }
});

/**
 * GET /voice/tts/provider
 * Get current TTS provider
 */
voice.get("/tts/provider", (c) => {
  return c.json({
    success: true,
    provider: actionRouter.getTTSProvider(),
  });
});

/**
 * POST /voice/tts/provider
 * Set TTS provider (macos, elevenlabs, openai, piper)
 * Falls back to macOS if the provider's API key is missing
 */
voice.post("/tts/provider", async (c) => {
  try {
    const body = await c.req.json();
    const { provider } = body;

    if (!provider) {
      return c.json({ success: false, error: "Provider is required" }, 400);
    }

    const validProviders = ["macos", "elevenlabs", "openai", "piper", "espeak", "system"];
    if (!validProviders.includes(provider)) {
      return c.json({
        success: false,
        error: `Invalid provider. Must be one of: ${validProviders.join(", ")}`,
      }, 400);
    }

    const result = await actionRouter.setTTSProvider(provider);

    return c.json({
      success: result.success,
      provider: result.provider,
      error: result.error,
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to set provider",
    }, 500);
  }
});
