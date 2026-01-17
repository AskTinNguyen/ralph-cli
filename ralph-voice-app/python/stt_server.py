#!/usr/bin/env python3
"""
Ralph Voice STT Server

A simple HTTP server that provides speech-to-text using faster-whisper.
Supports multiple audio formats (WAV, WebM, MP3, etc.) via PyAV.
Runs on localhost:5001 by default.

Usage:
    python3 stt_server.py

Environment variables:
    STT_PORT: Port to listen on (default: 5001)
    STT_MODEL: Whisper model size (default: base.en)
"""

import os
import sys
import json
import tempfile
import logging
import io
import struct
import array
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs
import cgi

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global model instance
whisper_model = None
model_name = os.environ.get('STT_MODEL', 'base.en')


def load_model():
    """Load the Whisper model."""
    global whisper_model

    if whisper_model is not None:
        return whisper_model

    try:
        from faster_whisper import WhisperModel
        logger.info(f"Loading faster-whisper model: {model_name}")

        # Use CPU for compatibility
        device = "cpu"
        compute_type = "int8"

        try:
            import torch
            if torch.cuda.is_available():
                device = "cuda"
                compute_type = "float16"
                logger.info("Using CUDA for inference")
        except ImportError:
            pass

        whisper_model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            download_root=os.path.expanduser("~/.cache/whisper")
        )
        logger.info(f"Model loaded successfully on {device}")
        return whisper_model

    except ImportError:
        logger.error("faster-whisper not installed. Run: pip install faster-whisper")
        sys.exit(1)


def convert_to_wav(audio_data: bytes, input_format: str = None) -> bytes:
    """Convert audio data to WAV format using PyAV."""
    try:
        import av

        # Create input container from bytes
        input_container = av.open(io.BytesIO(audio_data), format=input_format)

        # Find audio stream
        audio_stream = None
        for stream in input_container.streams:
            if stream.type == 'audio':
                audio_stream = stream
                break

        if not audio_stream:
            raise ValueError("No audio stream found")

        # Decode audio and get samples
        samples = []
        sample_rate = audio_stream.rate or 16000

        for frame in input_container.decode(audio_stream):
            # Convert to mono float32
            frame_array = frame.to_ndarray()
            if len(frame_array.shape) > 1:
                # Average channels for mono
                frame_array = frame_array.mean(axis=0)
            samples.extend(frame_array.flatten().tolist())

        input_container.close()

        if not samples:
            raise ValueError("No audio samples decoded")

        # Convert to 16-bit PCM
        import numpy as np
        samples_array = np.array(samples, dtype=np.float32)

        # Normalize and convert to int16
        max_val = np.max(np.abs(samples_array))
        if max_val > 0:
            samples_array = samples_array / max_val
        samples_int16 = (samples_array * 32767).astype(np.int16)

        # Create WAV file
        wav_buffer = io.BytesIO()

        # WAV header
        num_samples = len(samples_int16)
        data_size = num_samples * 2  # 16-bit = 2 bytes per sample

        wav_buffer.write(b'RIFF')
        wav_buffer.write(struct.pack('<I', 36 + data_size))
        wav_buffer.write(b'WAVE')
        wav_buffer.write(b'fmt ')
        wav_buffer.write(struct.pack('<I', 16))  # Subchunk1Size
        wav_buffer.write(struct.pack('<H', 1))   # AudioFormat (PCM)
        wav_buffer.write(struct.pack('<H', 1))   # NumChannels (mono)
        wav_buffer.write(struct.pack('<I', 16000))  # SampleRate
        wav_buffer.write(struct.pack('<I', 16000 * 2))  # ByteRate
        wav_buffer.write(struct.pack('<H', 2))   # BlockAlign
        wav_buffer.write(struct.pack('<H', 16))  # BitsPerSample
        wav_buffer.write(b'data')
        wav_buffer.write(struct.pack('<I', data_size))
        wav_buffer.write(samples_int16.tobytes())

        return wav_buffer.getvalue()

    except Exception as e:
        logger.error(f"Audio conversion error: {e}")
        raise


def detect_audio_format(audio_data: bytes) -> str:
    """Detect audio format from magic bytes."""
    if audio_data[:4] == b'RIFF':
        return 'wav'
    elif audio_data[:4] == b'\x1aE\xdf\xa3':  # WebM/Matroska
        return 'webm'
    elif audio_data[:3] == b'ID3' or audio_data[:2] == b'\xff\xfb':  # MP3
        return 'mp3'
    elif audio_data[:4] == b'OggS':
        return 'ogg'
    elif audio_data[:4] == b'fLaC':
        return 'flac'
    else:
        return None


def transcribe_audio(audio_data: bytes, content_type: str = None) -> dict:
    """Transcribe audio data to text."""
    model = load_model()

    # Detect format
    detected_format = detect_audio_format(audio_data)
    logger.info(f"Detected format: {detected_format}, content-type: {content_type}")

    # Convert to WAV if not already
    if detected_format != 'wav':
        try:
            logger.info(f"Converting from {detected_format or 'unknown'} to WAV...")
            audio_data = convert_to_wav(audio_data, detected_format)
            logger.info(f"Conversion successful, {len(audio_data)} bytes")
        except Exception as e:
            logger.error(f"Audio conversion failed: {e}")
            return {
                "success": False,
                "error": f"Audio conversion failed: {e}",
                "text": ""
            }

    # Write audio to temporary file
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        f.write(audio_data)
        temp_path = f.name

    try:
        # Transcribe
        segments, info = model.transcribe(
            temp_path,
            beam_size=5,
            language="en",
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
            )
        )

        # Collect all segments
        text_parts = []
        for segment in segments:
            text_parts.append(segment.text.strip())

        full_text = " ".join(text_parts).strip()

        return {
            "success": True,
            "text": full_text,
            "language": info.language,
            "duration": info.duration
        }

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return {
            "success": False,
            "error": str(e),
            "text": ""
        }
    finally:
        # Clean up temp file
        try:
            os.unlink(temp_path)
        except:
            pass


class STTHandler(BaseHTTPRequestHandler):
    """HTTP request handler for STT server."""

    def log_message(self, format, *args):
        """Override to use our logger."""
        logger.info(f"{self.address_string()} - {format % args}")

    def send_json(self, data: dict, status: int = 200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """Handle GET requests."""
        if self.path == '/health':
            self.send_json({
                "status": "healthy",
                "model": model_name,
                "ready": whisper_model is not None
            })
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        """Handle POST requests."""
        if '/transcribe' in self.path:
            try:
                content_type = self.headers.get('Content-Type', '')
                content_length = int(self.headers.get('Content-Length', 0))

                if content_length == 0:
                    self.send_json({"error": "No audio data"}, 400)
                    return

                audio_data = None

                # Handle multipart form data
                if 'multipart/form-data' in content_type:
                    # Parse multipart data
                    form = cgi.FieldStorage(
                        fp=self.rfile,
                        headers=self.headers,
                        environ={
                            'REQUEST_METHOD': 'POST',
                            'CONTENT_TYPE': content_type,
                        }
                    )

                    # Get the file field
                    if 'file' in form:
                        file_item = form['file']
                        audio_data = file_item.file.read()
                        logger.info(f"Received multipart file: {len(audio_data)} bytes")
                    else:
                        self.send_json({"error": "No 'file' field in form data"}, 400)
                        return
                else:
                    # Raw binary data
                    audio_data = self.rfile.read(content_length)
                    logger.info(f"Received raw audio: {len(audio_data)} bytes")

                if not audio_data:
                    self.send_json({"error": "No audio data received"}, 400)
                    return

                # Transcribe
                result = transcribe_audio(audio_data, content_type)

                if result["success"]:
                    logger.info(f"Transcribed: {result['text']}")
                    self.send_json(result)
                else:
                    self.send_json(result, 500)

            except Exception as e:
                logger.error(f"Error handling transcription: {e}")
                import traceback
                traceback.print_exc()
                self.send_json({"error": str(e)}, 500)
        else:
            self.send_json({"error": "Not found"}, 404)


def main():
    """Run the STT server."""
    port = int(os.environ.get('STT_PORT', 5001))

    # Pre-load the model
    logger.info("Pre-loading Whisper model...")
    load_model()

    # Start server
    server = HTTPServer(('127.0.0.1', port), STTHandler)
    logger.info(f"STT server listening on http://127.0.0.1:{port}")
    logger.info("Endpoints:")
    logger.info("  GET  /health     - Health check")
    logger.info("  POST /transcribe - Transcribe audio (WAV, WebM, MP3, etc.)")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
