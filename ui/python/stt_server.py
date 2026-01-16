#!/usr/bin/env python3
"""
Whisper STT Server for Ralph Voice Agent

A lightweight Flask server that provides speech-to-text transcription
using OpenAI's Whisper model. Runs locally for privacy and low latency.

Usage:
    python stt_server.py [--port PORT] [--model MODEL]

    --port: Server port (default: 5001)
    --model: Whisper model size (default: base)
             Options: tiny, base, small, medium, large

Dependencies:
    pip install openai-whisper flask flask-cors
"""

import argparse
import io
import logging
import os
import tempfile
import time
from typing import Optional

# Fix SSL certificate issues on macOS
try:
    import certifi
    os.environ['SSL_CERT_FILE'] = certifi.where()
    os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()
except ImportError:
    pass  # certifi not installed, use system certs

from flask import Flask, request, jsonify
from flask_cors import CORS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('stt_server')

app = Flask(__name__)
CORS(app)  # Enable CORS for UI requests

# Global model instance (lazy loaded)
_whisper_model = None
_model_name = "base"


def get_whisper_model():
    """Lazy load Whisper model to reduce startup time."""
    global _whisper_model, _model_name

    if _whisper_model is None:
        logger.info(f"Loading Whisper model: {_model_name}")
        import whisper
        _whisper_model = whisper.load_model(_model_name)
        logger.info(f"Whisper model loaded successfully")

    return _whisper_model


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'model': _model_name,
        'model_loaded': _whisper_model is not None
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transcribe audio to text using Whisper.

    Accepts audio file via multipart form data or raw binary.
    Supported formats: wav, mp3, m4a, webm, ogg

    Request:
        POST /transcribe
        Content-Type: multipart/form-data or audio/*

        For multipart: file=<audio_file>
        For raw: binary audio data in request body

    Query params:
        language: Optional language code (e.g., 'en', 'es', 'zh')

    Response:
        {
            "success": true,
            "text": "transcribed text",
            "language": "en",
            "duration_ms": 1234
        }
    """
    start_time = time.time()

    try:
        # Get audio data from request
        audio_data = None

        if 'file' in request.files:
            # Multipart form data
            audio_file = request.files['file']
            audio_data = audio_file.read()
            logger.info(f"Received audio file: {audio_file.filename}, size: {len(audio_data)} bytes")
        elif request.data:
            # Raw binary data
            audio_data = request.data
            logger.info(f"Received raw audio data, size: {len(audio_data)} bytes")
        else:
            return jsonify({
                'success': False,
                'error': 'No audio data provided. Send audio via multipart form (file) or raw binary.'
            }), 400

        if len(audio_data) < 100:
            return jsonify({
                'success': False,
                'error': 'Audio data too small. Minimum size is 100 bytes.'
            }), 400

        # Get optional language parameter
        language: Optional[str] = request.args.get('language')

        # Write audio to temp file for Whisper
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            temp_path = temp_file.name
            temp_file.write(audio_data)

        try:
            # Get model and transcribe
            model = get_whisper_model()

            # Transcribe options
            options = {
                'fp16': False,  # Use FP32 for CPU compatibility
            }
            if language:
                options['language'] = language

            result = model.transcribe(temp_path, **options)

            duration_ms = int((time.time() - start_time) * 1000)

            logger.info(f"Transcription completed in {duration_ms}ms: '{result['text'][:100]}...'")

            return jsonify({
                'success': True,
                'text': result['text'].strip(),
                'language': result.get('language', 'unknown'),
                'duration_ms': duration_ms,
                'segments': [
                    {
                        'start': seg['start'],
                        'end': seg['end'],
                        'text': seg['text'].strip()
                    }
                    for seg in result.get('segments', [])
                ]
            })

        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    except Exception as e:
        logger.exception(f"Transcription error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/models', methods=['GET'])
def list_models():
    """List available Whisper model sizes."""
    return jsonify({
        'available': ['tiny', 'base', 'small', 'medium', 'large'],
        'current': _model_name,
        'recommendations': {
            'tiny': 'Fastest, lowest quality (~1GB VRAM)',
            'base': 'Good balance of speed/quality (~1GB VRAM) - RECOMMENDED',
            'small': 'Better quality, slower (~2GB VRAM)',
            'medium': 'High quality, much slower (~5GB VRAM)',
            'large': 'Best quality, slowest (~10GB VRAM)'
        }
    })


def main():
    global _model_name

    parser = argparse.ArgumentParser(description='Whisper STT Server for Ralph Voice Agent')
    parser.add_argument('--port', type=int, default=5001, help='Server port (default: 5001)')
    parser.add_argument('--model', type=str, default='base',
                        choices=['tiny', 'base', 'small', 'medium', 'large'],
                        help='Whisper model size (default: base)')
    parser.add_argument('--preload', action='store_true',
                        help='Preload model at startup instead of lazy loading')

    args = parser.parse_args()

    _model_name = args.model

    logger.info(f"Starting Whisper STT Server on port {args.port}")
    logger.info(f"Using model: {_model_name}")

    if args.preload:
        logger.info("Preloading model...")
        get_whisper_model()

    # Run Flask app
    app.run(
        host='0.0.0.0',
        port=args.port,
        threaded=True,
        debug=False
    )


if __name__ == '__main__':
    main()
