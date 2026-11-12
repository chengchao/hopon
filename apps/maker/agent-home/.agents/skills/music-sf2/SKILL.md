---
name: music-sf2
description: How to write a game's looping background music as music.py, a Python score that recorded instruments play (FluidSynth and a General MIDI bank) into music.wav. Load when a job asks for music in an acoustic, orchestral, folk, period or world style that chiptune can't voice.
---

# Sampled music (music.py)

You write the notes; FluidSynth plays them with recorded instruments: strings, flutes, guitars, harps, horns, accordions. Copy the skeleton below into `music.py`, write the score where it says so, and run `python3 music.py`. It writes `music.wav`, a 44.1 kHz stereo loop of 20–40 s that wraps without a click: whatever rings past the end (releases, reverb) is folded back onto the start.

`midiutil` and `numpy` are installed; install nothing else. A game has one music file: delete `music.mjs` if the workspace has one.

## The score

- `inst(name_or_program, pan=64)` returns a part on its own channel: one of the names in `GM`, or any General MIDI program number 0–127. Pan is 0 left, 64 centre, 127 right.
- `part.note(start, midi, beats, vel=90)`: start and beats are in beats; vel 1–127 is how hard it's played, so it is your dynamics and accents.
- `part.cc(start, controller, value)`: 7 volume (set once at beat 0 to balance the parts), 11 expression for swells, 91 reverb send, 93 chorus send.
- `drum(start, key, vel=90)` plays General MIDI percussion: 35/36 kick, 38/40 snare, 42 closed hat, 46 open hat, 49 crash, 51 ride, 54 tambourine, 56 cowbell, 60/61 bongos, 62–64 congas, 69 cabasa, 70 maracas, 75 claves, 76/77 woodblocks, 81 triangle.

## Writing it well

- Pick the instruments a real ensemble of the style would have, 3–6 parts, and spread them: the lead and bass in the centre, the others panned left and right (30–50 from centre), so the mix isn't mono.
- Give each part its own register: bass below MIDI 52, accompaniment 48–72, the lead above it.
- Sampled instruments sound fake on robotic playing. Vary velocity (stronger on the downbeat, softer on passing notes), let sustained notes overlap slightly (beats a touch longer than the gap), and give plucked and percussive ones short, varied lengths.
- Strings, organ and pads hold chords; don't retrigger them every beat. Guitar, harp and piano carry rhythm well as broken chords.
- A melody that breathes: phrases of 2–4 bars with rests between, a clear motif repeated and varied, a peak note saved for the B section.
- The loop's last bar should lead back into its first, so the wrap sounds like the piece going on.

## Skeleton

```python
import subprocess
import wave

import numpy as np
from midiutil import MIDIFile

BPM = 120
BEATS_PER_BAR = 4  # 3 for a waltz; for 6/8, count dotted quarters as beats
BARS = 16  # 16 bars of 4/4 at 120 BPM = 32 s
LENGTH_BEATS = BARS * BEATS_PER_BAR
TAIL_BEATS = 8  # rendered past the end, then folded onto the start
RATE = 44100
SF2 = "/opt/hopon/GeneralUser-GS.sf2"

GM = {
    "piano": 0, "harpsichord": 6, "celesta": 8, "glockenspiel": 9, "music box": 10,
    "marimba": 12, "xylophone": 13, "organ": 19, "accordion": 21, "harmonica": 22,
    "nylon guitar": 24, "steel guitar": 25, "acoustic bass": 32, "fretless bass": 35,
    "violin": 40, "viola": 41, "cello": 42, "contrabass": 43, "tremolo strings": 44,
    "pizzicato": 45, "harp": 46, "timpani": 47, "strings": 48, "slow strings": 49,
    "choir": 52, "trumpet": 56, "trombone": 57, "tuba": 58, "french horn": 60,
    "brass": 61, "oboe": 68, "english horn": 69, "bassoon": 70, "clarinet": 71,
    "piccolo": 72, "flute": 73, "recorder": 74, "pan flute": 75, "ocarina": 79,
    "sitar": 104, "banjo": 105, "shamisen": 106, "koto": 107, "kalimba": 108,
    "bagpipe": 109, "fiddle": 110, "shanai": 111, "steel drums": 114,
}

midi = MIDIFile(16, deinterleave=False)
midi.addTempo(0, 0, BPM)
channels = iter(c for c in range(16) if c != 9)


class Part:
    def __init__(self, program, pan):
        self.ch = next(channels)
        midi.addProgramChange(self.ch, self.ch, 0, GM.get(program, program))
        self.cc(0, 10, pan)

    def note(self, start, pitch, beats, vel=90):
        midi.addNote(self.ch, self.ch, int(pitch), start, beats, int(max(1, min(127, vel))))

    def cc(self, start, controller, value):
        midi.addControllerEvent(self.ch, self.ch, start, controller, int(value))


def inst(program, pan=64):
    return Part(program, pan)


def drum(start, key, vel=90):
    midi.addNote(9, 9, key, start, 0.25, int(max(1, min(127, vel))))


# … write the score: parts, chords, bass, melody, percussion …

# A silent event past the end keeps FluidSynth rendering the tails.
midi.addControllerEvent(0, 0, LENGTH_BEATS + TAIL_BEATS, 110, 0)
with open("song.mid", "wb") as f:
    midi.writeFile(f)
subprocess.run(
    ["fluidsynth", "-ni", "-q", "-g", "0.6", "-r", str(RATE), "-F", "raw.wav", SF2, "song.mid"],
    check=True,
)

with wave.open("raw.wav") as w:
    raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2) / 32768.0
length = round(LENGTH_BEATS * 60 / BPM * RATE)
mix = np.zeros((length, 2))
for i in range(0, len(raw), length):  # everything past the loop's end, onto its start
    chunk = raw[i : i + length]
    mix[: len(chunk)] += chunk
mix = np.tanh(mix * 1.2 / np.abs(mix).max())  # normalized, then soft-limited: peaks land at 0.83

with wave.open("music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"music.wav {length / RATE:.1f} s")
```
