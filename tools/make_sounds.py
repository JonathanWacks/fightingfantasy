#!/usr/bin/env python3
"""
Synthesise the skill's sound effects as Alexa-ready MP3s (mono, 24 kHz, 48 kbps).

Everything here is generated from scratch (sine waves, noise, envelopes), so the
files are original and free to use. Replace any of them with a real recording of
the same name if you prefer: Alexa needs MP3, 48 kbps, 16/22.05/24 kHz.

Usage:  python3 tools/make_sounds.py                 (regenerates every audio/*.mp3)
        python3 tools/make_sounds.py door_creak wolf (regenerates only those)
Needs numpy, scipy and ffmpeg. Each sound has its own random seed, so
regenerating one never changes another.
"""
import os
import subprocess
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 24000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audio')
rng = np.random.default_rng(1986)  # reseeded per sound in __main__


# ---------- building blocks ----------

def t(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def brown(dur):
    x = np.cumsum(noise(dur))
    x -= np.linspace(x[0], x[-1], len(x))  # remove drift
    return x / (np.max(np.abs(x)) + 1e-9)


def band(x, lo, hi, order=4):
    return sosfilt(butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def lowpass(x, f, order=4):
    return sosfilt(butter(order, f, 'lowpass', fs=SR, output='sos'), x)


def highpass(x, f, order=4):
    return sosfilt(butter(order, f, 'highpass', fs=SR, output='sos'), x)


def env(n, attack=0.005, decay=None, release=0.05):
    """Attack then exponential decay (if decay) and a short release, length n samples."""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    e[:a] = np.linspace(0, 1, a)
    if decay:
        e[a:] = np.exp(-(np.arange(n - a) / SR) / decay)
    r = min(n, max(1, int(release * SR)))
    e[-r:] *= np.linspace(1, 0, r)
    return e


def tone(freq, dur, decay=None, attack=0.005, harmonics=(1.0,)):
    """freq may be a number or an array (glide)."""
    n = int(dur * SR)
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,)) if np.ndim(freq) else np.full(n, float(freq))
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = sum(a * np.sin((k + 1) * phase) for k, a in enumerate(harmonics))
    return x * env(n, attack, decay)


def bell(f0, dur, decay=1.2):
    """Church-bell partials (hum, prime, tierce, quint, nominal...)."""
    partials = [(0.5, 0.6, 1.6), (1.0, 1.0, 1.0), (1.19, 0.5, 0.8), (1.5, 0.35, 0.6),
                (2.0, 0.5, 0.5), (2.5, 0.2, 0.35), (3.0, 0.15, 0.25), (4.2, 0.08, 0.15)]
    n = int(dur * SR)
    out = np.zeros(n)
    for ratio, amp, dk in partials:
        out += amp * np.sin(2 * np.pi * f0 * ratio * t(dur) + rng.uniform(0, 6)) * np.exp(-t(dur) / (decay * max(dk, 0.45)))
    strike = band(noise(0.03), 1000, 6000) * np.linspace(1, 0, int(0.03 * SR))
    out[:len(strike)] += 0.3 * strike
    return out * env(n, 0.002, None, 0.2)


def metal(dur, f0=900, decay=0.25):
    """Inharmonic metallic ring, like a blade strike."""
    ratios = [1.0, 1.52, 2.21, 2.83, 3.67, 4.9]
    n = int(dur * SR)
    out = sum(np.sin(2 * np.pi * f0 * r * t(dur) + rng.uniform(0, 6)) * np.exp(-t(dur) / (decay / (1 + i * 0.4)))
              for i, r in enumerate(ratios)) / 3
    click = highpass(noise(0.015), 2000) * np.linspace(1, 0, int(0.015 * SR))
    out[:len(click)] += click
    return out * env(n, 0.001, None, 0.05)


def thump(dur=0.3, f0=110, f1=45):
    body = tone(np.geomspace(f0, f1, int(dur * SR)), dur, decay=0.08, attack=0.001)
    knock = lowpass(noise(dur), 900) * env(int(dur * SR), 0.001, 0.03)
    return body + 0.6 * knock


def whoosh(dur=0.4, f_from=300, f_to=3000):
    n = int(dur * SR)
    x = noise(dur)
    centres = np.geomspace(f_from, f_to, n)
    # crude moving band: mix three fixed bands weighted by position
    bands = [band(x, 200, 800), band(x, 700, 2200), band(x, 2000, 6000)]
    pos = np.log(centres / f_from) / np.log(f_to / f_from)
    w = [np.clip(1 - 2 * pos, 0, 1), 1 - np.abs(2 * pos - 1), np.clip(2 * pos - 1, 0, 1)]
    y = sum(b * wi for b, wi in zip(bands, w))
    return y * np.sin(np.pi * np.linspace(0, 1, n)) ** 2


def reverb(x, size=1.2, wet=0.3):
    ir = noise(size) * np.exp(-t(size) / (size / 5))
    ir = lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    y = fftconvolve(x, ir)[:len(x) + int(size * SR)]
    dry = np.concatenate([x, np.zeros(len(y) - len(x))])
    return (1 - wet) * dry + wet * y


def place(total, items):
    """items: [(start_seconds, signal, gain)] mixed into a buffer of `total` seconds."""
    out = np.zeros(int(total * SR))
    for start, sig, gain in items:
        i = max(0, int(start * SR))
        seg = sig[: max(0, len(out) - i)]
        out[i:i + len(seg)] += gain * seg
    return out


def fade(x, fin=0.3, fout=0.6):
    a, b = int(fin * SR), int(fout * SR)
    x = x.copy()
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def saw(freq, dur):
    n = int(dur * SR)
    f = freq if np.ndim(freq) else np.full(n, float(freq))
    ph = np.cumsum(f) / SR
    return 2 * (ph - np.floor(ph + 0.5))


def brass(freq, dur):
    x = lowpass(saw(freq, dur), min(3500, freq * 6))
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t(dur))
    return x * vib * env(int(dur * SR), 0.03, None, 0.12)


# ---------- the sounds ----------

def s_swing():
    return whoosh(0.35, 400, 4000)


def s_hit():
    return thump(0.3, 140, 50) + 0.25 * metal(0.3, 700, 0.06)


def s_hurt():
    x = thump(0.4, 100, 40) * 1.3
    return np.tanh(x * 2) * 0.7


def s_clash():
    return reverb(metal(1.0, 950, 0.35) + 0.4 * metal(1.0, 1330, 0.2), 0.8, 0.25)


def s_battle():
    items = [(0.0, whoosh(0.3), 0.6)]
    for i, (st, f) in enumerate([(0.15, 900), (0.55, 1150), (0.75, 820), (1.2, 1000), (1.45, 1250)]):
        items.append((st, metal(0.6, f, 0.22), 0.9))
        items.append((st - 0.1, whoosh(0.25, 500, 3500), 0.4))
    items.append((0.0, lowpass(brown(2.2), 300), 0.3))
    return reverb(place(2.2, items), 1.0, 0.3)


def s_drumroll():
    dur = 1.4
    hits = []
    times = np.cumsum(np.full(30, 1 / 24.0))
    for i, st in enumerate(times):
        h = band(noise(0.06), 180, 5000) * env(int(0.06 * SR), 0.001, 0.02)
        hits.append((st, h, 0.25 + 0.6 * i / len(times)))
    cym = highpass(noise(1.0), 4000) * env(int(1.0 * SR), 0.002, 0.35)
    boom = thump(0.5, 90, 40)
    hits += [(times[-1] + 0.05, cym, 0.7), (times[-1] + 0.05, boom, 0.9)]
    return place(dur + 0.6, hits)


def s_lucky():
    notes = [1046.5, 1318.5, 1568.0, 2093.0]
    items = [(i * 0.09, tone(f, 0.9, decay=0.35, harmonics=(1, 0.3, 0.1)), 0.6) for i, f in enumerate(notes)]
    return reverb(place(1.4, items), 1.2, 0.35)


def s_unlucky():
    items = [(0, tone(392, 0.35, 0.3, harmonics=(1, 0.5, 0.25)), 0.6), (0.3, tone(277, 0.6, 0.4, harmonics=(1, 0.5, 0.25)), 0.6)]
    return place(1.0, items)


def s_victory():
    seq = [(0.0, 392, 0.18), (0.2, 523.3, 0.18), (0.4, 659.3, 0.18), (0.6, 784, 1.1)]
    items = []
    for st, f, d in seq:
        items.append((st, brass(f, d), 0.45))
        items.append((st, brass(f / 2, d), 0.25))
    items.append((0.6, brass(523.3, 1.1), 0.3))
    return reverb(place(2.2, items), 1.5, 0.3)


def s_bell():
    return reverb(bell(262, 5.0, 1.5), 2.0, 0.25)


def s_death():
    return reverb(place(6.5, [(0, bell(185, 6.0, 1.8), 0.8)]), 2.0, 0.25)


def s_drink():
    items = []
    for i in range(3):
        f = np.geomspace(180, 420, int(0.18 * SR))
        g = tone(f, 0.18, decay=0.08, attack=0.01) + 0.3 * lowpass(noise(0.18), 1200) * env(int(0.18 * SR), 0.005, 0.05)
        items.append((0.1 + i * 0.32, g, 0.7))
    items.append((1.05, tone(np.geomspace(300, 900, int(0.15 * SR)), 0.15, 0.06), 0.3))
    return place(1.4, items)


def s_magic():
    items = []
    for i in range(14):
        f = rng.choice([1567, 1760, 2093, 2349, 2637, 3136, 3520])
        items.append((i * 0.07 + rng.uniform(0, 0.03), tone(f, 0.6, decay=0.2, harmonics=(1, 0.2)), 0.25))
    items.append((0, tone(np.geomspace(500, 1500, int(1.2 * SR)), 1.2, None, 0.3) * 0.3, 0.3))
    return reverb(place(1.8, items), 1.5, 0.45)


def s_blast():
    dur = 1.6
    n = int(dur * SR)
    x = lowpass(noise(dur), 2500) * np.exp(-t(dur) / 0.35)
    sub = tone(np.geomspace(90, 30, n), dur, decay=0.5, attack=0.002)
    rise = whoosh(0.4, 200, 5000)
    return reverb(place(dur + 0.4, [(0, rise, 0.5), (0.35, x, 0.9), (0.35, sub, 0.9)]), 1.2, 0.3)


def creak(dur, base=70):
    """
    Stick-slip friction: a train of separate clicks whose rate wanders (slow clicks
    read as a creak, faster ones as a squeal), each ringing woody resonances.
    No low end, so it never turns into a buzz.
    """
    n = int(dur * SR)
    tt = t(dur)
    # rate contour: wanders between groaning clicks and a tighter squeal
    wander = lowpass(noise(dur), 3) * 40
    rate = base * (0.7 + 0.6 * np.sin(np.pi * tt / dur) + 0.35 * np.sin(2 * np.pi * 0.9 * tt) + wander)
    rate = np.clip(rate, 12, 260)
    pulses = np.zeros(n)
    pos = 0.0
    while True:
        i = int(pos)
        if i >= n:
            break
        pulses[i] = rng.uniform(0.4, 1.0)
        pos += SR / rate[i] * rng.uniform(0.85, 1.15)
    # stick-slip comes in bursts, not a steady drone
    bursts = np.clip(0.35 + lowpass(noise(dur), 5) * 25, 0, 1)
    pulses *= bursts
    # woody resonances (narrow bands), slightly detuned over time by the pulse rate
    body = (band(pulses, 650, 760, 2) * 1.0 + band(pulses, 1050, 1250, 2) * 0.9 +
            band(pulses, 1700, 1950, 2) * 0.7 + band(pulses, 2600, 3000, 2) * 0.45 +
            band(pulses, 3800, 4400, 2) * 0.2)
    body = highpass(body, 450, 4)
    return body * np.sin(np.pi * np.linspace(0, 1, n)) ** 0.4


def s_door_creak():
    return reverb(creak(1.6, 75), 0.8, 0.25)


def s_door_creak_long():
    return reverb(creak(3.2, 60), 1.0, 0.3)


def s_door_open():
    click = highpass(noise(0.04), 1500) * env(int(0.04 * SR), 0.001, 0.01)
    c = creak(1.0, 110)
    c = c / (np.max(np.abs(c)) + 1e-9)
    return reverb(place(1.4, [(0, click, 0.35), (0.1, c, 0.9)]), 0.6, 0.2)


def s_door_shut():
    return reverb(place(1.0, [(0, thump(0.5, 80, 35), 1.0), (0.02, highpass(noise(0.05), 1500) * env(int(0.05 * SR), 0.001, 0.015), 0.5)]), 0.9, 0.3)


def step():
    return lowpass(noise(0.12), 700) * env(int(0.12 * SR), 0.003, 0.03) + 0.3 * highpass(noise(0.12), 2500) * env(int(0.12 * SR), 0.001, 0.01)


def s_footsteps():
    return reverb(place(3.2, [(i * 0.5 + rng.uniform(-0.02, 0.02), step(), 0.9 - 0.05 * i) for i in range(6)]), 1.2, 0.35)


def s_running():
    return reverb(place(2.2, [(i * 0.22, step(), 0.9) for i in range(9)]), 0.8, 0.25)


def s_wind():
    dur = 4.5
    x = noise(dur)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * 0.25 * t(dur) + 1)
    y = band(x, 250, 700) * (1 - lfo) + band(x, 600, 1600) * lfo
    whistle = tone(700 + 250 * np.sin(2 * np.pi * 0.18 * t(dur)), dur, None, 0.5) * 0.05
    return fade(y + whistle, 1.0, 1.5)


def s_thunder():
    dur = 4.5
    crack = highpass(noise(0.25), 800) * env(int(0.25 * SR), 0.002, 0.07)
    rumble = lowpass(brown(dur), 180) * (np.exp(-t(dur) / 1.6) * (1 + 0.5 * np.sin(2 * np.pi * 1.3 * t(dur))))
    return reverb(place(dur, [(0, crack, 0.7), (0.05, rumble, 1.3)]), 1.8, 0.35)


def s_storm():
    dur = 4.5
    rain = highpass(noise(dur), 2500) * 0.25 * (0.8 + 0.2 * lowpass(noise(dur), 3) * 10)
    return fade(rain, 0.8, 1.2) + 0.8 * s_thunder()[: int(dur * SR)]


def drip(f=None):
    f = f or rng.uniform(900, 1700)
    return tone(np.geomspace(f, f * 2.2, int(0.07 * SR)), 0.07, decay=0.02, attack=0.001)


def s_drips():
    items = [(st, drip(), 0.6) for st in [0.2, 1.1, 1.6, 2.6, 3.0]]
    return reverb(place(3.6, items), 0.9, 0.25)


def s_droplets():
    items = [(st, drip(), 0.5) for st in np.sort(rng.uniform(0.05, 2.4, 12))]
    return reverb(place(3.0, items), 0.8, 0.22)


def splash(dur=0.5):
    return band(noise(dur), 300, 4000) * env(int(dur * SR), 0.02, 0.12)


def s_rowing():
    items = []
    for i in range(3):
        st = 0.2 + i * 1.2
        items += [(st, splash(0.6), 0.6), (st + 0.35, lowpass(splash(0.5), 900), 0.5)]
    return reverb(place(4.0, items), 0.8, 0.2)


def s_wading():
    items = []
    for i in range(5):
        items += [(0.1 + i * 0.6, lowpass(splash(0.45), 1500), 0.6), (0.1 + i * 0.6, step(), 0.25)]
    return reverb(place(3.0, items), 0.8, 0.25)


def wail(dur, f_lo, f_hi, rough=0.0):
    tt = t(dur)
    contour = f_lo + (f_hi - f_lo) * np.sin(np.pi * np.clip(tt / dur * 1.1, 0, 1)) ** 1.5
    vib = 1 + 0.02 * np.sin(2 * np.pi * 5 * tt)
    x = tone(contour * vib, dur, None, 0.25, harmonics=(1, 0.35, 0.15, 0.06))
    x += 0.6 * tone(contour * vib * 1.007, dur, None, 0.3, harmonics=(1, 0.3))
    if rough:
        x += rough * band(noise(dur), 300, 2000) * np.sin(np.pi * np.linspace(0, 1, len(tt)))
    return x * np.sin(np.pi * np.linspace(0, 1, len(tt))) ** 0.8


def s_ghost():
    return reverb(wail(2.6, 420, 640) * 0.6, 2.2, 0.55)


def s_ghost_wail():
    return reverb(wail(3.2, 500, 950, 0.15) * 0.7 + 0.2 * wail(3.2, 330, 600), 2.5, 0.55)


def s_wolf():
    return reverb(wail(3.0, 380, 720) * 0.7, 2.5, 0.5)


def growl_sig(dur, f=95, rough=0.8):
    tt = t(dur)
    am = 0.5 + 0.5 * np.sin(2 * np.pi * 28 * tt) * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * tt))
    x = lowpass(noise(dur), 500) * am * rough + saw(f * (1 + 0.05 * np.sin(2 * np.pi * 2 * tt)), dur) * 0.4
    x = lowpass(x, 900)
    return np.tanh(2 * x) * np.sin(np.pi * np.linspace(0, 1, len(tt))) ** 0.7


def s_growl():
    return growl_sig(1.6, 85)


def s_roar():
    return reverb(growl_sig(2.2, 70, 1.2) + 0.4 * band(noise(2.2), 400, 2500) * np.sin(np.pi * np.linspace(0, 1, int(2.2 * SR))), 1.5, 0.3)


def s_march():
    items = []
    for i in range(5):
        st = 0.1 + i * 0.55
        items += [(st, thump(0.5, 70, 30), 1.0), (st + 0.01, metal(0.4, 420 + 30 * (i % 2), 0.12), 0.25),
                  (st + 0.02, lowpass(noise(0.3), 400) * env(int(0.3 * SR), 0.002, 0.08), 0.5)]
    return reverb(place(3.2, items), 1.4, 0.35)


def s_darts():
    items = []
    for i, st in enumerate([0.0, 0.18, 0.31]):
        whistle = tone(np.geomspace(3200, 1600, int(0.18 * SR)), 0.18, None, 0.01) * 0.3 + 0.3 * whoosh(0.18, 1500, 5000)
        thunk = lowpass(noise(0.08), 1500) * env(int(0.08 * SR), 0.001, 0.02)
        items += [(st, whistle, 0.7), (st + 0.17, thunk, 0.9)]
    return reverb(place(1.0, items), 0.6, 0.25)


def s_drone():
    dur = 4.0
    x = sum(a * tone(f * (1 + 0.002 * k), dur, None, 1.2, harmonics=(1, 0.3, 0.1)) for k, (f, a) in enumerate([(55, 1), (82.4, 0.6), (110, 0.5), (164.8, 0.25), (116.5, 0.15)]))
    return reverb(fade(x, 1.5, 1.2), 2.0, 0.3)


SOUNDS = {name[2:]: fn for name, fn in globals().items() if name.startswith('s_')}


def write_mp3(name, x):
    x = np.asarray(x, dtype=float)
    peak = np.max(np.abs(x)) or 1.0
    x = 0.89 * x / peak  # normalise to about -1 dBFS
    # trim the silent end of reverb tails so speech resumes promptly
    loud = np.where(np.abs(x) > 0.004)[0]
    if len(loud):
        end = min(len(x), loud[-1] + int(0.05 * SR))
        x = x[:end] * np.concatenate([np.ones(max(0, end - int(0.08 * SR))), np.linspace(1, 0, min(end, int(0.08 * SR)))])
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        wav = f.name
    wavfile.write(wav, SR, (x * 32767).astype(np.int16))
    out = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', str(SR),
                    '-b:a', '48k', '-codec:a', 'libmp3lame', '-write_xing', '0',
                    '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', out], check=True)
    os.unlink(wav)
    return out


if __name__ == '__main__':
    import sys
    import zlib
    os.makedirs(OUT, exist_ok=True)
    wanted = sys.argv[1:] or sorted(SOUNDS)
    unknown = [w for w in wanted if w not in SOUNDS]
    if unknown:
        sys.exit('unknown sound(s): ' + ', '.join(unknown) + '\navailable: ' + ', '.join(sorted(SOUNDS)))
    for name in wanted:
        rng = np.random.default_rng(zlib.crc32(name.encode()))
        path = write_mp3(name, SOUNDS[name]())
        print(f'{name:16s} {os.path.getsize(path) / 1024:6.1f} KB')
