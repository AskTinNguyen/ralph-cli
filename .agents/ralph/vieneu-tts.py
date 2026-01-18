#!/usr/bin/env python3
"""
VieNeu-TTS wrapper for Ralph CLI
Performs text-to-speech using cloned Vietnamese voices

Usage:
  python vieneu-tts.py --text "Xin chao" --voice my_voice --output /tmp/output.wav
  echo "Xin chao" | python vieneu-tts.py --voice my_voice --output /tmp/output.wav

Source: claude-auto-speak 45a1ee0, eb16cab, 554c00c
"""

import sys
import argparse
import os
from pathlib import Path
import numpy as np

def main():
    parser = argparse.ArgumentParser(description='VieNeu-TTS wrapper for Ralph CLI')
    parser.add_argument('--text', type=str, help='Text to synthesize')
    parser.add_argument('--voice', type=str, required=True, help='Voice name (preset or cloned)')
    parser.add_argument('--output', type=str, required=True, help='Output WAV file path')
    parser.add_argument('--model', type=str, default='0.3b',
                        help='Model variant (0.3b or 0.5b)')

    args = parser.parse_args()

    # Get text from argument or stdin
    text = args.text
    if not text:
        if not sys.stdin.isatty():
            text = sys.stdin.read().strip()
        else:
            print("Error: No text provided", file=sys.stderr)
            print("Usage: python vieneu-tts.py --text 'Xin chao' --voice my_voice --output /tmp/output.wav",
                  file=sys.stderr)
            sys.exit(1)

    if not text:
        print("Error: Empty text", file=sys.stderr)
        sys.exit(1)

    try:
        # Import VieNeu (lazy import to fail fast if not installed)
        from vieneu import VieNeuTTS
        import soundfile as sf

        # Initialize model with appropriate backbone
        # Map model variant to Hugging Face repo (handle both "0.3b" and "vieneu-0.3b" formats)
        model_variant = args.model.replace('vieneu-', '')
        backbone_map = {
            '0.3b': 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf',
            '0.5b': 'pnnbao-ump/VieNeu-TTS-0.5B-q4-gguf'
        }
        backbone_repo = backbone_map.get(model_variant, backbone_map['0.3b'])

        model = VieNeuTTS(backbone_repo=backbone_repo)

        # Check if voice is a preset voice (Binh, Tuyen, Vinh, Doan, Ly, Ngoc)
        preset_voices = ['Binh', 'Tuyen', 'Vinh', 'Doan', 'Ly', 'Ngoc']

        if args.voice in preset_voices:
            # Use preset voice
            audio = model.infer(
                text=text,
                voice=model.get_preset_voice(args.voice)
            )
        else:
            # Try to load cloned voice reference
            # Ralph-cli uses ~/.agents/ralph/vieneu for shared installation
            vieneu_dir = Path.home() / ".agents/ralph/vieneu"
            references_dir = vieneu_dir / "references"
            ref_audio_file = references_dir / f"{args.voice}.wav"

            if not ref_audio_file.exists():
                print(f"Error: Voice not found: {args.voice}", file=sys.stderr)
                print(f"Available preset voices: {', '.join(preset_voices)}", file=sys.stderr)
                print(f"Available cloned voices:", file=sys.stderr)
                if references_dir.exists():
                    for v in references_dir.glob("*.wav"):
                        print(f"  - {v.stem}", file=sys.stderr)
                else:
                    print("  (none)", file=sys.stderr)
                sys.exit(1)

            # Encode reference audio on-the-fly
            ref_codes = model.encode_reference(str(ref_audio_file))

            # Synthesize speech using infer method
            audio = model.infer(
                text=text,
                ref_codes=ref_codes,
                ref_text=""  # Empty ref_text works for voice cloning
            )

        # Save to output file
        sf.write(args.output, audio, model.sample_rate)

        print(f"Generated: {args.output}", file=sys.stderr)

    except ImportError as e:
        print(f"Error: VieNeu-TTS not installed", file=sys.stderr)
        print(f"Run: .agents/ralph/setup/vieneu-setup.sh", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
