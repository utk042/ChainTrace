"""Build the 1440p demo: one continuous narration take, footage warped onto it.

The narration is never cut inside speech. Extra silence is only ever added in
the middle of an existing pause. The screen recording is split at its logged
actions, and each piece is retimed so the action lands on the word that
describes it.
"""
import json, subprocess, os
import imageio_ffmpeg

D = os.path.dirname(os.path.abspath(__file__)) + '/'
FF = imageio_ffmpeg.get_ffmpeg_exe()
AUDIO = os.environ.get('AUDIO', D + 'full/take1.mp3')
WORDS = json.load(open(AUDIO + '.words.json'))
MARKS = json.load(open(D + 'hq/marks.json'))
LEAD = 0.8                                   # silence before the first word
W, H, FPS = 2560, 1440, 30


def word(text, after=0.0, end=False):
    """Original-take time of the first word matching `text` at or after `after`."""
    for w, s, e in WORDS:
        if s >= after and w.lower().strip('.,!?').startswith(text.lower()):
            return e if end else s
    raise KeyError(text)


import re
_sd = subprocess.run([FF, '-i', AUDIO, '-af', 'silencedetect=noise=-40dB:d=0.15', '-f', 'null', '-'],
                     capture_output=True, text=True).stderr
SILENCES = list(zip(map(float, re.findall(r'silence_start: ([0-9.]+)', _sd)),
                    map(float, re.findall(r'silence_end: ([0-9.]+)', _sd))))


def gap_before(t):
    """Midpoint of the measured silence just before word-start time t.

    Looks only between the previous word and this one; if nothing there is
    below the strict threshold (a comma said quickly), it takes the
    quietest 40 ms inside that window instead.
    """
    prev = max(w_s for w, w_s, e in WORDS if w_s < t - 0.05)
    cands = [(a, b) for a, b in SILENCES if b <= t + 0.35 and b > prev]
    if cands:
        a, b = max(cands, key=lambda ab: ab[1])
        return (a + b) / 2
    import numpy as np
    raw = subprocess.run([FF, '-v', 'error', '-ss', str(prev), '-to', str(t), '-i', AUDIO,
                          '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(float)
    win = 640
    e = [np.sqrt(np.mean(x[i:i + win] ** 2)) for i in range(0, len(x) - win, 160)]
    i = int(np.argmin(e))
    return prev + (i * 160 + win / 2) / 16000


DEC = word('decision')
G = word('graph', DEC)                                   # "In the Graph Explorer"
# (midpoint of an existing pause in the original take, seconds of silence to add)
# A negative value trims that much out of the middle of an overlong pause.
INSERTS = [(gap_before(word('investigators')), 0.2),
           (gap_before(word('here', 40)), 0.6),
           (gap_before(word('in', DEC + 1)), -0.4),
           (gap_before(word('selecting')), 0.6),
           (gap_before(word('with', word('step'))), 0.6),
           (gap_before(word('chain', word('reports'))), -0.7)]
print('inserts', [(round(m, 2), x) for m, x in INSERTS])


def final(t):
    return LEAD + t + sum(x for m, x in INSERTS if m < t)


_h, _m, _s = (subprocess.run([FF, '-i', AUDIO], capture_output=True, text=True).stderr
               .split('Duration: ')[1].split(',')[0].split(':'))
audio_len = int(_h) * 3600 + int(_m) * 60 + float(_s)

# ---- narration track: take1 with silence spliced into pauses
pieces, prev = [], 0.0
for m, x in INSERTS:
    if x >= 0:
        pieces.append(('a', prev, m)); pieces.append(('s', x)); prev = m
    else:
        pieces.append(('a', prev, m + x / 2)); prev = m - x / 2
pieces.append(('a', prev, audio_len))
fc, labels = [f'anullsrc=r=48000:cl=mono,atrim=0:{LEAD}[lead]'], ['[lead]']
for i, pc in enumerate(pieces):
    if pc[0] == 'a':
        fc.append(f'[0:a]aresample=48000,aformat=channel_layouts=mono,atrim={pc[1]}:{pc[2]},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,areverse,afade=t=in:d=0.02,areverse[p{i}]')
    else:
        fc.append(f'anullsrc=r=48000:cl=mono,atrim=0:{pc[1]}[p{i}]')
    labels.append(f'[p{i}]')
fc.append(''.join(labels) + f'concat=n={len(labels)}:v=0:a=1,loudnorm=I=-14:TP=-1:LRA=9,aresample=48000[a]')
subprocess.run([FF, '-y', '-loglevel', 'error', '-i', AUDIO, '-filter_complex', ';'.join(fc),
                '-map', '[a]', '-c:a', 'pcm_s24le', D + 'hq/narration.wav'], check=True)
narr_len = final(audio_len)

# ---- where each logged action must land in the final timeline
target = {
    'screen start':    final(word('investigators')) - 0.9,
    'alerts nav':      final(word('highest')) - 0.3,
    'alert open':      final(word('here', 40)),
    'explanation':     final(word('explains')),
    'decision':        final(word('decision')) + 0.2,
    'decision end':    final(G) - 2.4,
    'graph take':      final(G) - 2.4,
    'graph found':     final(G) + 0.6,
    'wallet selected': final(word('highlights')),
    'E 1':             final(word('expand', DEC)) + 0.1,
    'trace start':     final(word('with', word('step'))),
    'find':            final(word('shortest')),
    'export':          final(word('exported')),
    'end':             final(word('reports', end=True)) + 0.9,
}
order = ['screen start', 'alerts nav', 'alert open', 'explanation', 'decision', 'decision end',
         'graph take', 'graph found', 'wallet selected', 'E 1', 'trace start', 'find', 'export', 'end']
take_start = float(subprocess.run([FF, '-i', D + 'hq/take.mkv'], capture_output=True, text=True).stderr
                   .split('start: ')[1].split(',')[0].split()[0])

segs = []
for a, b in zip(order, order[1:]):
    if a == 'decision end':          # the page reload between the two halves is cut
        continue
    src0, src1 = MARKS[a] - take_start, MARKS[b] - take_start
    dst = target[b] - target[a]
    segs.append((a, b, src0, src1, dst))
    print(f'{a:>15} -> {b:<15} src {src1 - src0:5.2f}s  dst {dst:5.2f}s  speed x{(src1 - src0) / dst:4.2f}')

slide1_end = final(word('cryptocurrency')) - 0.25
screen0 = target['screen start']
close0 = target['end']
total = narr_len + 1.2
print(f'slides 0-{slide1_end:.1f}-{screen0:.1f}  screen -{close0:.1f}  closing -{total:.1f}')

sc = f'scale={W}:{H}:flags=lanczos,setsar=1,fps={FPS},format=yuv420p'
inputs = ['-loop', '1', '-t', f'{slide1_end:.3f}', '-i', D + 'hqslides/a-1.png',
          '-loop', '1', '-t', f'{screen0 - slide1_end:.3f}', '-i', D + 'hqslides/b-2.png',
          '-loop', '1', '-t', f'{total - close0:.3f}', '-i', D + 'hqslides/closing.png',
          '-i', D + 'hq/take.mkv', '-i', D + 'hq/narration.wav']
fc = [f'[0:v]{sc},fade=t=in:st=0:d=0.5,fade=t=out:st={slide1_end - 0.3:.3f}:d=0.3[s1]',
      f'[1:v]{sc},fade=t=in:st=0:d=0.3,fade=t=out:st={screen0 - slide1_end - 0.3:.3f}:d=0.3[s2]',
      f'[2:v]{sc},fade=t=in:st=0:d=0.4,fade=t=out:st={total - close0 - 0.8:.3f}:d=0.8[s3]']
fc.append(f'[3:v]setpts=PTS-STARTPTS,split={len(segs)}' + ''.join(f'[r{i}]' for i in range(len(segs))))
seg_labels = []
for i, (a, b, s0, s1, dst) in enumerate(segs):
    f = dst / (s1 - s0)
    fade = ',fade=t=in:st=0:d=0.3' if i == 0 else ''
    if a == 'graph take':
        fade = ',fade=t=in:st=0:d=0.25'
    if b == 'decision end':
        fade = f',fade=t=out:st={dst - 0.25:.3f}:d=0.25'
    if b == 'end':
        fade = f',fade=t=out:st={dst - 0.3:.3f}:d=0.3'
    fc.append(f'[r{i}]trim={s0:.4f}:{s1:.4f},setpts=(PTS-STARTPTS)*{f:.5f},{sc}{fade}[v{i}]')
    seg_labels.append(f'[v{i}]')
fc.append('[s1][s2]' + ''.join(seg_labels) + f'[s3]concat=n={len(seg_labels) + 3}:v=1:a=0[v]')
fc.append(f'[4:a]apad,atrim=0:{total:.3f},aformat=channel_layouts=stereo[a]')
subprocess.run([FF, '-y', '-loglevel', 'error'] + inputs + [
    '-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', str(FPS), '-g', str(FPS // 2), '-bf', '2', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-t', f'{total:.3f}', D + 'ChainTrace_demo_1440p.mp4'], check=True)
print('wrote', f'{total:.1f}s')
