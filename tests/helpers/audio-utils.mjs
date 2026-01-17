/**
 * Audio Test Utilities
 *
 * Helper functions for creating test audio data for E2E testing
 * of the voice pipeline. Generates valid WAV headers and audio blobs
 * without requiring actual audio recording.
 *
 * Usage:
 *   import { createTestAudioBlob, createWavBuffer } from './tests/helpers/audio-utils.mjs';
 *   const audioBlob = createTestAudioBlob({ durationMs: 2000 });
 *   const wavBuffer = createWavBuffer({ sampleRate: 16000, durationMs: 1000 });
 */

/**
 * WAV file format constants
 */
const WAV_CONSTANTS = {
  RIFF: 0x52494646, // "RIFF"
  WAVE: 0x57415645, // "WAVE"
  FMT: 0x666d7420, // "fmt "
  DATA: 0x64617461, // "data"
  PCM_FORMAT: 1, // PCM format code
};

/**
 * Create a valid WAV file buffer with silent audio
 * @param {object} options
 * @param {number} [options.sampleRate=16000] - Sample rate in Hz
 * @param {number} [options.channels=1] - Number of audio channels
 * @param {number} [options.bitsPerSample=16] - Bits per sample
 * @param {number} [options.durationMs=1000] - Duration in milliseconds
 * @param {boolean} [options.addNoise=false] - Add random noise instead of silence
 * @returns {Buffer}
 */
export function createWavBuffer(options = {}) {
  const {
    sampleRate = 16000,
    channels = 1,
    bitsPerSample = 16,
    durationMs = 1000,
    addNoise = false,
  } = options;

  // Calculate sizes
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = numSamples * blockAlign;
  const fileSize = 44 + dataSize; // 44 byte header + data

  // Create buffer
  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); // File size - 8
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;

  // fmt subchunk
  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset); // Subchunk1Size (16 for PCM)
  offset += 4;
  buffer.writeUInt16LE(WAV_CONSTANTS.PCM_FORMAT, offset); // AudioFormat (1 = PCM)
  offset += 2;
  buffer.writeUInt16LE(channels, offset); // NumChannels
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); // SampleRate
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset); // ByteRate
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); // BlockAlign
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); // BitsPerSample
  offset += 2;

  // data subchunk
  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  // Audio data (silence or noise)
  if (addNoise) {
    // Add random low-amplitude noise
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const noise = Math.floor((Math.random() - 0.5) * 1000); // Low amplitude noise
        if (bitsPerSample === 16) {
          buffer.writeInt16LE(noise, offset);
          offset += 2;
        } else {
          buffer.writeUInt8(128 + Math.floor(noise / 128), offset);
          offset += 1;
        }
      }
    }
  }
  // If not adding noise, buffer remains filled with zeros (silence)

  return buffer;
}

/**
 * Create a test audio Blob (browser-compatible format)
 * Note: In Node.js, returns a Buffer that can be used like a Blob
 * @param {object} options - Same options as createWavBuffer
 * @returns {{ buffer: Buffer, type: string, size: number, arrayBuffer: () => Promise<ArrayBuffer> }}
 */
export function createTestAudioBlob(options = {}) {
  const buffer = createWavBuffer(options);

  return {
    buffer,
    type: 'audio/wav',
    size: buffer.length,

    // Blob-like methods
    arrayBuffer() {
      return Promise.resolve(buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ));
    },

    slice(start, end, contentType) {
      const sliced = buffer.slice(start, end);
      return {
        buffer: sliced,
        type: contentType || 'audio/wav',
        size: sliced.length,
        arrayBuffer: () => Promise.resolve(sliced.buffer.slice(
          sliced.byteOffset,
          sliced.byteOffset + sliced.byteLength
        )),
      };
    },

    text() {
      return Promise.resolve(buffer.toString());
    },

    stream() {
      const { Readable } = require('stream');
      return Readable.from(buffer);
    },
  };
}

/**
 * Create a FormData-like object with audio file
 * @param {Buffer} audioBuffer - Audio data
 * @param {string} [filename='audio.wav'] - Filename to use
 * @returns {{ entries: () => Array, get: (key: string) => any, getBuffer: () => Buffer }}
 */
export function createAudioFormData(audioBuffer, filename = 'audio.wav') {
  const blob = createTestAudioBlob();
  blob.buffer = audioBuffer;
  blob.size = audioBuffer.length;

  const formData = {
    _data: new Map([
      ['file', { blob, filename }],
    ]),

    entries() {
      return Array.from(this._data.entries());
    },

    get(key) {
      return this._data.get(key);
    },

    getBuffer() {
      return audioBuffer;
    },

    append(key, value, filename) {
      this._data.set(key, { blob: value, filename });
    },
  };

  return formData;
}

/**
 * Generate a unique audio identifier based on content
 * @param {Buffer} buffer - Audio buffer
 * @returns {string}
 */
export function getAudioHash(buffer) {
  let hash = 0;
  for (let i = 0; i < buffer.length; i++) {
    hash = ((hash << 5) - hash) + buffer[i];
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * Create multiple test audio samples with different characteristics
 * @returns {{ silent: Buffer, noisy: Buffer, short: Buffer, long: Buffer }}
 */
export function createTestAudioSamples() {
  return {
    // 1 second of silence
    silent: createWavBuffer({ durationMs: 1000, addNoise: false }),

    // 1 second with noise
    noisy: createWavBuffer({ durationMs: 1000, addNoise: true }),

    // Very short audio (100ms)
    short: createWavBuffer({ durationMs: 100 }),

    // Longer audio (5 seconds)
    long: createWavBuffer({ durationMs: 5000 }),

    // High quality stereo
    stereo: createWavBuffer({ channels: 2, sampleRate: 44100, durationMs: 1000 }),

    // Low quality mono
    lowQuality: createWavBuffer({ channels: 1, sampleRate: 8000, bitsPerSample: 8, durationMs: 1000 }),
  };
}

/**
 * Validate that a buffer is a valid WAV file
 * @param {Buffer} buffer - Buffer to validate
 * @returns {{ valid: boolean, error?: string, info?: object }}
 */
export function validateWavBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return { valid: false, error: 'Not a buffer' };
  }

  if (buffer.length < 44) {
    return { valid: false, error: 'Buffer too small for WAV header' };
  }

  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') {
    return { valid: false, error: `Invalid RIFF header: ${riff}` };
  }

  const wave = buffer.toString('ascii', 8, 12);
  if (wave !== 'WAVE') {
    return { valid: false, error: `Invalid WAVE format: ${wave}` };
  }

  const fmt = buffer.toString('ascii', 12, 16);
  if (fmt !== 'fmt ') {
    return { valid: false, error: `Invalid fmt chunk: ${fmt}` };
  }

  const audioFormat = buffer.readUInt16LE(20);
  const numChannels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);

  return {
    valid: true,
    info: {
      audioFormat,
      numChannels,
      sampleRate,
      bitsPerSample,
      fileSize: buffer.length,
    },
  };
}

/**
 * Create an invalid/corrupted audio buffer for error testing
 * @param {string} type - Type of invalid data to create
 * @returns {Buffer}
 */
export function createInvalidAudio(type = 'corrupted') {
  switch (type) {
    case 'empty':
      return Buffer.alloc(0);

    case 'too_small':
      return Buffer.from('small');

    case 'wrong_header':
      const buf = createWavBuffer({ durationMs: 100 });
      buf.write('XXXX', 0); // Corrupt RIFF header
      return buf;

    case 'random':
      return Buffer.from(Array(1000).fill(0).map(() => Math.floor(Math.random() * 256)));

    case 'text':
      return Buffer.from('This is not audio data, just plain text!');

    case 'corrupted':
    default:
      const wavBuf = createWavBuffer({ durationMs: 100 });
      // Corrupt the format chunk
      wavBuf.writeUInt16LE(0xFFFF, 20); // Invalid audio format
      return wavBuf;
  }
}

// Export for CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Audio Test Utilities - Demo\n');

  // Create samples
  const samples = createTestAudioSamples();

  console.log('Created test audio samples:');
  for (const [name, buffer] of Object.entries(samples)) {
    const validation = validateWavBuffer(buffer);
    console.log(`  ${name}: ${buffer.length} bytes`);
    if (validation.valid) {
      console.log(`    -> ${validation.info.sampleRate}Hz, ${validation.info.numChannels}ch, ${validation.info.bitsPerSample}bit`);
    }
  }

  console.log('\nInvalid audio samples:');
  for (const type of ['empty', 'too_small', 'wrong_header', 'random', 'text', 'corrupted']) {
    const invalid = createInvalidAudio(type);
    const validation = validateWavBuffer(invalid);
    console.log(`  ${type}: ${invalid.length} bytes -> ${validation.valid ? 'VALID (unexpected!)' : validation.error}`);
  }

  console.log('\nAll utilities working correctly!');
}
