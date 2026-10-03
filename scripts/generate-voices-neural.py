"""Generate arena-style announcer clips with Kokoro-82M (Apache-2.0) and ffmpeg.

Lines come from scripts/voice-lines.json. Each value is either the text or an object
{"text": ..., "voice": ..., "speed": ...} to override settings for that line.
Output MP3s go to public/assets/voice/<id>.mp3, so the game picks them up by id.

Setup (once):
  py -3.12 -m venv %TEMP%\\cloud-defender-tts
  %TEMP%\\cloud-defender-tts\\Scripts\\python -m pip install kokoro soundfile numpy

Examples:
  python scripts/generate-voices-neural.py
  python scripts/generate-voices-neural.py --only shield-lost game-over
  python scripts/generate-voices-neural.py --audition am_onyx am_michael bm_george --only wave-1 shield-lost
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_RATE = 24000

PRESETS = {
    # Deep, slowed, compressed, with a short arena echo.
    "arena": (
        "highpass=f=70,"
        "equalizer=f=160:t=q:w=1:g=4,"
        "equalizer=f=2800:t=q:w=1.2:g=3,"
        "acompressor=threshold=-22dB:ratio=6:attack=4:release=90:makeup=5,"
        "aecho=0.85:0.55:70|140|230:0.28|0.16|0.08,"
        "alimiter=limit=0.95"
    ),
    "clean": "highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=2",
    # Very deep, boxy mask resonance: short comb echoes give a metallic helmet colour.
    "helmet": (
        "highpass=f=55,"
        "equalizer=f=110:t=q:w=1:g=6,"
        "equalizer=f=900:t=q:w=1.5:g=3,"
        "lowpass=f=4200,"
        "aecho=0.9:0.7:6|11|17:0.45|0.3|0.2,"
        "acompressor=threshold=-24dB:ratio=7:attack=3:release=120:makeup=6,"
        "aecho=0.85:0.5:90|180:0.18|0.08,"
        "alimiter=limit=0.95"
    ),
}


def find_ffmpeg() -> str:
    for candidate in (
        os.environ.get("FFMPEG"),
        shutil.which("ffmpeg"),
        str(Path(tempfile.gettempdir()) / "cloud-defender-ffmpeg/node_modules/ffmpeg-static/ffmpeg.exe"),
    ):
        if candidate and Path(candidate).exists():
            return candidate
    sys.exit("ffmpeg not found. Put it on PATH, set FFMPEG, or run scripts/generate-voices.ps1 once.")


def load_lines(path: Path) -> dict[str, dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {k: (v if isinstance(v, dict) else {"text": v}) for k, v in raw.items()}


def synthesize(pipeline, text: str, voice: str, speed: float) -> np.ndarray:
    chunks = [np.asarray(audio) for _, _, audio in pipeline(text, voice=voice, speed=speed)]
    if not chunks:
        raise RuntimeError(f"No audio produced for: {text!r}")
    return np.concatenate(chunks)


def style(ffmpeg: str, wav: Path, out: Path, preset: str, pitch: float, bitrate: str) -> None:
    trim_start = "silenceremove=start_periods=1:start_threshold=-45dB"
    trim_end = "areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse"
    # asetrate drops the pitch but also slows speech; atempo restores the pace so delivery stays punchy.
    shift = f"asetrate={SAMPLE_RATE}*{pitch},aresample={SAMPLE_RATE},atempo={1 / pitch:.4f}," if pitch != 1 else ""
    chain = f"{trim_start},{shift}{PRESETS[preset]},apad=pad_dur=0.25,{trim_end},loudnorm=I=-14:TP=-1:LRA=7"
    codec = ["-b:a", bitrate] if out.suffix == ".mp3" else []
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(wav), "-af", chain, "-ac", "1", "-ar", str(SAMPLE_RATE), *codec, str(out)],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lines", type=Path, default=ROOT / "scripts/voice-lines.json")
    parser.add_argument("--out", type=Path, default=ROOT / "public/assets/voice")
    parser.add_argument("--voice", default="am_michael", help="Kokoro voice id, e.g. am_onyx, am_michael, am_adam, bm_george")
    parser.add_argument("--speed", type=float, default=1.0, help="Kokoro speaking speed before pitch shift")
    parser.add_argument("--pitch", type=float, default=0.74, help="Pitch factor; 0.74 is about 5 semitones down (tempo is preserved)")
    parser.add_argument("--preset", choices=sorted(PRESETS), default="helmet")
    parser.add_argument("--bitrate", default="48k")
    parser.add_argument("--only", nargs="*", help="Only generate these line ids")
    parser.add_argument("--audition", nargs="*", metavar="VOICE", help="Render each listed voice into voice-reference/audition/<voice>/")
    args = parser.parse_args()

    from kokoro import KPipeline  # imported late so --help works without the model

    ffmpeg = find_ffmpeg()
    lines = load_lines(args.lines)
    if args.only:
        missing = set(args.only) - lines.keys()
        if missing:
            sys.exit(f"Unknown line ids: {', '.join(sorted(missing))}")
        lines = {k: v for k, v in lines.items() if k in args.only}

    pipelines: dict[str, KPipeline] = {}

    def pipeline_for(voice: str) -> KPipeline:
        lang = voice[0]  # 'a' = American English, 'b' = British English
        if lang not in pipelines:
            pipelines[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
        return pipelines[lang]

    audition_root = ROOT / "voice-reference/audition"  # gitignored
    targets = [(v, audition_root / v) for v in args.audition] if args.audition else [(None, args.out)]
    with tempfile.TemporaryDirectory() as tmp:
        for audition_voice, out_dir in targets:
            out_dir.mkdir(parents=True, exist_ok=True)
            for line_id, spec in lines.items():
                voice = audition_voice or spec.get("voice", args.voice)
                speed = float(spec.get("speed", args.speed))
                wav = Path(tmp) / f"{line_id}.wav"
                sf.write(wav, synthesize(pipeline_for(voice), spec["text"], voice, speed), SAMPLE_RATE)
                out = out_dir / f"{line_id}.mp3"
                style(ffmpeg, wav, out, spec.get("preset", args.preset), float(spec.get("pitch", args.pitch)), args.bitrate)
                print(f"{voice:<11} {line_id:<14} {out.stat().st_size:>6,} bytes  {spec['text']!r}")


if __name__ == "__main__":
    main()
