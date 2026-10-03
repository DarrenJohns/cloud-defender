"""Render cinematic audition mixes from procedural layers and credited CC0 source textures.

Requires NumPy and ffmpeg (PATH, FFMPEG, or the existing temporary ffmpeg installation).
Pass --install-palette to also install the approved S1-S4 game clips.
"""
import os
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "sound-audition"
RATE = 48000
RNG = np.random.default_rng(7342)


def find_ffmpeg():
    executable = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not executable:
        executable = str(Path(tempfile.gettempdir()) / "cloud-defender-ffmpeg/node_modules/ffmpeg-static/ffmpeg.exe")
    if not Path(executable).is_file():
        raise FileNotFoundError("ffmpeg is required to decode source textures and encode auditions.")
    return executable


FFMPEG = find_ffmpeg()


def turbulence(seconds, low, high):
    count = round(seconds * RATE)
    frequencies = np.fft.rfftfreq(count, 1 / RATE)
    spectrum = np.fft.rfft(RNG.normal(size=count))
    shape = 1 / np.sqrt(1 + (low / np.maximum(frequencies, 1)) ** 8)
    shape /= np.sqrt(1 + (frequencies / high) ** 8)
    samples = np.fft.irfft(spectrum * shape, n=count)
    return samples / max(1e-9, np.sqrt(np.mean(samples ** 2)))


def contour(seconds, attack, sustain, decay):
    time = np.arange(round(seconds * RATE)) / RATE
    return np.minimum(1, time / attack) ** 0.8 * np.exp(-np.maximum(0, time - sustain) * decay) * np.minimum(1, (seconds - time) / 0.08)


def texture(name, pitch, cutoff):
    # Lowering pitch changes duration too: intentional mass/stretch for source material.
    result = subprocess.run([
        FFMPEG, "-v", "error", "-i", str(OUT / name), "-af",
        f"aresample={RATE},asetrate={RATE}*{pitch},aresample={RATE},lowpass=f={cutoff}",
        "-ac", "1", "-ar", str(RATE), "-f", "f32le", "pipe:1",
    ], check=True, capture_output=True)
    return np.frombuffer(result.stdout, dtype="<f4").copy()


def layer(mix, source, when=0, gain=1, pan=0):
    start = round(when * RATE)
    count = min(len(source), len(mix) - start)
    if count <= 0:
        return
    # Equal-power positioning; low-end layers remain centred.
    gains = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)])
    mix[start:start + count] += source[:count, None] * gains * gain


def space(mix, amount, tail):
    dry = mix.copy()
    for channel in range(2):
        length = round(tail * RATE)
        impulse = turbulence(tail, 180, 3200)
        time = np.arange(length) / RATE
        impulse *= (1 - np.exp(-time * 35)) * np.exp(-time * 5 / tail)
        impulse /= np.sqrt(np.sum(impulse ** 2))
        impulse[:round(0.04 * RATE)] = 0
        count = len(mix) + length - 1
        fft_size = 1 << (count - 1).bit_length()
        convolution = np.fft.irfft(
            np.fft.rfft(dry[:, channel], fft_size) * np.fft.rfft(impulse, fft_size), fft_size,
        )[:len(mix)]
        mix[:, channel] += convolution * amount
    # Uneven early reflections avoid an obviously rhythmic echo.
    for delay, level in [(0.071, 0.12), (0.139, 0.08), (0.223, 0.05)]:
        offset = round(delay * RATE)
        mix[offset:] += dry[:-offset, ::-1] * level
    return mix


def explosion():
    mix = np.zeros((round(3.8 * RATE), 2))
    layer(mix, turbulence(2.8, 28, 170) * contour(2.8, 0.012, 0.3, 1.8), gain=0.65)
    layer(mix, turbulence(1.8, 90, 900) * contour(1.8, 0.004, 0.065, 3), gain=0.4)
    layer(mix, texture("scifi-explosionCrunch_003.ogg", 0.64, 2000), gain=0.36)
    for when, gain, pan in [(0.14, 0.23, -0.5), (0.32, 0.18, 0.6), (0.58, 0.12, -0.3)]:
        layer(mix, turbulence(0.8, 60, 700) * contour(0.8, 0.006, 0.035, 6), when, gain, pan)
    layer(mix, texture("impact-impactMetal_heavy_000.ogg", 0.5, 2400), 0.05, 0.32, -0.2)
    return space(mix, 0.3, 1.8)


def cannon():
    mix = np.zeros((round(1.6 * RATE), 2))
    layer(mix, turbulence(0.45, 40, 240) * contour(0.45, 0.003, 0.035, 10), gain=0.65)
    time = np.arange(round(0.38 * RATE)) / RATE
    phase = 2 * np.pi * np.cumsum(100 + 800 * np.exp(-time * 19)) / RATE
    carrier = np.sin(phase + np.sin(phase * 1.413) * 1.8 * np.exp(-time * 8))
    layer(mix, carrier * contour(0.38, 0.002, 0.01, 12), gain=0.2)
    layer(mix, texture("impact-impactPlate_heavy_002.ogg", 0.62, 3200), gain=0.55)
    layer(mix, turbulence(0.28, 450, 4200) * contour(0.28, 0.001, 0.005, 23), gain=0.1, pan=0.15)
    return space(mix, 0.2, 0.75)


def wall_hit():
    mix = np.zeros((round(1.5 * RATE), 2))
    layer(mix, turbulence(0.65, 55, 350) * contour(0.65, 0.003, 0.02, 9), gain=0.5)
    layer(mix, texture("impact-impactPlate_heavy_002.ogg", 0.78, 2100), gain=0.6)
    layer(mix, turbulence(0.32, 450, 2300) * contour(0.32, 0.001, 0.007, 20), gain=0.14)
    for when, pan in [(0.09, -0.5), (0.18, 0.6), (0.27, -0.2)]:
        layer(mix, turbulence(0.18, 250, 1800) * contour(0.18, 0.002, 0.01, 24), when, 0.065, pan)
    return space(mix, 0.15, 0.65)


def collapse():
    mix = explosion()
    rubble = texture("scifi-explosionCrunch_000.ogg", 0.58, 1700)
    layer(mix, rubble, 0.24, 0.4, -0.45)
    layer(mix, rubble, 0.48, 0.22, 0.5)
    return mix


def sourced_detonation():
    mix = np.zeros((round(3.8 * RATE), 2))
    # Preserve the designed explosion instead of burying it under synthesized bass.
    layer(mix, texture("qubodup-synthetic-explosion.flac", 0.85, 6500), gain=1)
    layer(mix, texture("scifi-explosionCrunch_003.ogg", 0.7, 1700), 0.12, 0.18, -0.3)
    layer(mix, texture("impact-impactMetal_heavy_000.ogg", 0.65, 1800), 0.26, 0.12, 0.4)
    return space(mix, 0.12, 0.9)


def energy_discharge(seconds, base, sweep, decay):
    time = np.arange(round(seconds * RATE)) / RATE
    frequency = base + sweep * np.exp(-time * decay)
    phase = 2 * np.pi * np.cumsum(frequency) / RATE
    # Inharmonic modes and changing modulation create a dispersive electrical resonance.
    signal = np.sin(phase + 3.5 * np.exp(-time * 5) * np.sin(phase * 1.731))
    signal += 0.45 * np.sin(phase * 2.417 + np.sin(phase * 0.637))
    signal += 0.2 * np.sin(phase * 3.913)
    return signal * contour(seconds, 0.003, 0.02, 5)


def resonant_blaster():
    mix = np.zeros((round(1.8 * RATE), 2))
    layer(mix, energy_discharge(0.7, 90, 850, 14), gain=0.55)
    layer(mix, energy_discharge(0.55, 130, 1400, 23), 0.009, 0.18, 0.4)
    layer(mix, turbulence(0.4, 35, 220) * contour(0.4, 0.004, 0.025, 11), gain=0.3)
    layer(mix, texture("impact-impactMetal_heavy_000.ogg", 0.9, 3200), gain=0.12)
    return space(mix, 0.16, 0.6)


def reactor_rupture():
    mix = np.zeros((round(4.2 * RATE), 2))
    layer(mix, energy_discharge(1.3, 55, 480, 3.5), gain=0.5, pan=-0.2)
    layer(mix, energy_discharge(0.8, 90, 950, 9), 0.06, 0.24, 0.5)
    layer(mix, texture("qubodup-synthetic-explosion.flac", 0.85, 4500), 0.13, 0.5)
    for when, pan in [(0.22, -0.6), (0.45, 0.6), (0.72, -0.3)]:
        layer(mix, energy_discharge(0.55, 60, 650, 12), when, 0.17, pan)
    layer(mix, turbulence(3, 30, 240) * contour(3, 0.04, 0.2, 1.9), 0.08, 0.4)
    return space(mix, 0.24, 1.4)


def shield_collapse():
    mix = np.zeros((round(2.3 * RATE), 2))
    layer(mix, energy_discharge(1.2, 160, 1800, 4), gain=0.38, pan=-0.35)
    layer(mix, energy_discharge(1.1, 110, 1250, 6), 0.015, 0.26, 0.35)
    time = np.arange(round(0.85 * RATE)) / RATE
    arcs = turbulence(0.85, 600, 4200) * np.maximum(0, np.sin(time * 61 + np.sin(time * 113))) ** 3
    layer(mix, arcs * contour(0.85, 0.005, 0.03, 4), gain=0.12)
    layer(mix, turbulence(0.5, 55, 260) * contour(0.5, 0.008, 0.04, 8), gain=0.18)
    return space(mix, 0.2, 0.9)


def shield_restoration():
    mix = np.zeros((round(2.8 * RATE), 2))
    time = np.arange(round(1.15 * RATE)) / RATE
    phase = 2 * np.pi * np.cumsum(110 + 460 * (time / 1.15) ** 1.5) / RATE
    swell = np.sin(np.pi * time / 1.15) ** 1.5
    layer(mix, (np.sin(phase + 0.7 * np.sin(phase * 1.5)) + 0.25 * np.sin(phase * 2)) * swell, gain=0.25)
    for index, frequency in enumerate([220, 330, 440, 660]):
        time = np.arange(round(0.85 * RATE)) / RATE
        shimmer = (np.sin(2 * np.pi * frequency * time)
                   + 0.15 * np.sin(2 * np.pi * frequency * 3.01 * time))
        layer(mix, shimmer * contour(0.85, 0.008, 0.02, 6),
              0.8 + index * 0.065, 0.13, (index - 1.5) / 2)
    layer(mix, turbulence(0.6, 70, 450) * contour(0.6, 0.01, 0.02, 9), 1.03, 0.15)
    return space(mix, 0.22, 1)


def master(mix):
    # Soft peak control, not an increase of every layer to full scale.
    mix = np.tanh(mix * 1.2)
    mix *= 0.85 / max(1e-9, np.max(np.abs(mix)))
    fade = min(round(0.15 * RATE), len(mix))
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return mix


def write(name, mix):
    with tempfile.TemporaryDirectory(prefix="cloud-defender-audio-") as folder:
        wav = Path(folder) / "mix.wav"
        with wave.open(str(wav), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes((mix * 32767).astype("<i2").tobytes())
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "192k", str(OUT / name)], check=True)
    peak = np.max(np.abs(mix))
    rms = np.sqrt(np.mean(mix ** 2))
    print(f"{name}: {len(mix) / RATE:.2f}s stereo, peak {20 * np.log10(peak):.1f} dBFS, RMS {20 * np.log10(rms):.1f} dBFS")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--install-palette", action="store_true", help="Copy approved S1-S4 clips into gameplay; S5 remains the reference mix")
    args = parser.parse_args()
    effects = {
        "cinematic-hull-detonation.mp3": master(explosion()),
        "cinematic-heavy-cannon.mp3": master(cannon()),
        "cinematic-firewall-impact.mp3": master(wall_hit()),
        "cinematic-firewall-collapse.mp3": master(collapse()),
        "spacecraft-source-detonation.mp3": master(sourced_detonation()),
        "scifi-resonant-blaster.mp3": master(resonant_blaster()),
        "scifi-reactor-rupture.mp3": master(reactor_rupture()),
        "scifi-shield-collapse.mp3": master(shield_collapse()),
        "scifi-shield-restoration.mp3": master(shield_restoration()),
    }
    for name, mix in effects.items():
        write(name, mix)
    sequence = np.zeros((round(8 * RATE), 2))
    for name, when, gain in [
        ("cinematic-heavy-cannon.mp3", 0.15, 0.75),
        ("cinematic-firewall-impact.mp3", 0.42, 0.6),
        ("cinematic-heavy-cannon.mp3", 1.65, 0.75),
        ("cinematic-hull-detonation.mp3", 1.95, 1),
        ("cinematic-firewall-collapse.mp3", 4.25, 1),
    ]:
        mix = effects[name]
        start = round(when * RATE)
        count = min(len(mix), len(sequence) - start)
        sequence[start:start + count] += mix[:count] * gain
    write("cinematic-combat-sequence.mp3", master(sequence))
    sequence = np.zeros((round(10 * RATE), 2))
    for name, when, gain in [
        ("scifi-resonant-blaster.mp3", 0.1, 0.7),
        ("scifi-resonant-blaster.mp3", 0.7, 0.65),
        ("scifi-reactor-rupture.mp3", 1, 0.9),
        ("scifi-shield-collapse.mp3", 4.4, 0.6),
        ("scifi-shield-restoration.mp3", 6.5, 0.7),
    ]:
        start = round(when * RATE)
        mix = effects[name]
        count = min(len(mix), len(sequence) - start)
        sequence[start:start + count] += mix[:count] * gain
    write("scifi-action-sequence.mp3", master(sequence))
    if args.install_palette:
        destination = ROOT / "public" / "assets" / "sfx"
        destination.mkdir(parents=True, exist_ok=True)
        for source, target in [
            ("scifi-resonant-blaster.mp3", "player-cannon.mp3"),
            ("scifi-reactor-rupture.mp3", "alien-destruction.mp3"),
            ("scifi-shield-collapse.mp3", "shield-loss.mp3"),
            ("scifi-shield-restoration.mp3", "shield-acquired.mp3"),
        ]:
            shutil.copyfile(OUT / source, destination / target)


if __name__ == "__main__":
    main()
