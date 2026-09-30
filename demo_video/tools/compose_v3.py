"""Assemble the ChainTrace demo video from slides, screen takes and voice lines.

usage: python compose.py <voice_dir> <out.mp4>
voice_dir holds one audio file per line id (s1a.wav / s1a.mp3 ...).
"""
import json, subprocess, sys, glob, os
import imageio_ffmpeg

D = os.path.dirname(os.path.abspath(__file__)) + '/'
FF = imageio_ffmpeg.get_ffmpeg_exe()
voice_dir, out = sys.argv[1], sys.argv[2]
IDS = ['s1','s2','s3','s4a','s4b','s4c','s5a','s5b','s5c','s5d','s5e','s5f','s6']
meta = json.load(open(D + 'rec/meta.json'))
M = meta['MARKS']
SCREEN_A, SCREEN_B = 42.0, 36.0          # take A covers screen 0-42, take B 42-78


def dur(path):
    r = subprocess.run([FF, '-i', path], capture_output=True, text=True).stderr
    h, m, s = r.split('Duration: ')[1].split(',')[0].split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


clip = {}
for lid in IDS:
    f = (glob.glob(f'{voice_dir}/{lid}.*') or [None])[0]
    assert f, f'missing voice line {lid}'
    clip[lid] = (f, dur(f))

place = {}
def put(lid, t):
    place[lid] = t
    return t + clip[lid][1]

# slides
e = put('s1', 0.7);             slide1 = e + 0.5
e = put('s2', slide1 + 0.3);   slide2 = e + 0.6
SO = slide2
anchor = {'s3': 0.4,
          's4a': M['alert open'] - 0.6, 's4b': M['explanation'] + 0.1, 's4c': M['decision'] - 2.0,
          's5a': M['graph found'] - 3.0, 's5b': M['wallet selected'] - 0.8, 's5c': M['E 1'] - 0.7,
          's5d': M['trace start'] + 1.0, 's5e': M['trace'] + 0.3, 's5f': M['export'] - 1.2}
e = SO
for lid, a in anchor.items():
    e = put(lid, max(SO + a, e + 0.25))
screen_len = max(SCREEN_A + SCREEN_B, e - SO + 0.8)
close0 = SO + screen_len
e = put('s6', close0 + 0.5)
total = e + 1.5
print(f'slide1 0-{slide1:.1f}  slide2 -{slide2:.1f}  screen -{close0:.1f}  closing -{total:.1f}')
for lid in place:
    print(f'  {lid} {place[lid]:6.2f} -> {place[lid] + clip[lid][1]:6.2f}')

# ---- video
W, H = 1920, 1080
sc = f'scale={W}:{H}:flags=lanczos,setsar=1,fps=30,format=yuv420p'
def fades(d):
    return f'fade=t=in:st=0:d=0.35,fade=t=out:st={d - 0.35:.3f}:d=0.35'
inputs = ['-loop', '1', '-t', f'{slide1:.3f}', '-i', D + 'slide-1.png',
          '-loop', '1', '-t', f'{slide2 - slide1:.3f}', '-i', D + 'slide-2.png',
          '-ss', f"{meta['offA']:.3f}", '-t', f'{SCREEN_A:.3f}', '-i', meta['vA'],
          '-ss', f"{meta['offB']:.3f}", '-t', f'{SCREEN_B:.3f}', '-i', meta['vB'],
          '-loop', '1', '-t', f'{total - close0:.3f}', '-i', D + 'closing.png']
pad = screen_len - SCREEN_A - SCREEN_B
fc = [f'[0:v]{sc},{fades(slide1)}[v0]',
      f'[1:v]{sc},{fades(slide2 - slide1)}[v1]',
      f'[2:v]setpts=PTS-STARTPTS,{sc},fade=t=in:st=0:d=0.35[v2]',
      f'[3:v]setpts=PTS-STARTPTS,{sc},tpad=stop_mode=clone:stop_duration={pad + 0.05:.3f},'
      f'fade=t=out:st={SCREEN_B + pad - 0.35:.3f}:d=0.35[v3]',
      f'[4:v]{sc},{fades(total - close0)}[v4]',
      '[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[v]']

# ---- audio
ai = []
for i, lid in enumerate(place):
    ai += ['-i', clip[lid][0]]
    ms = int(place[lid] * 1000)
    fc.append(f'[{5 + i}:a]aresample=48000,aformat=channel_layouts=mono,adelay={ms}[a{i}]')
n = len(place)
fc.append(''.join(f'[a{i}]' for i in range(n)) +
          f'amix=inputs={n}:normalize=0,apad,atrim=0:{total:.3f},'
          'loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo[a]')

cmd = [FF, '-y', '-loglevel', 'error'] + inputs + ai + [
    '-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k',
    '-ar', '48000', '-movflags', '+faststart', '-t', f'{total:.3f}', out]
subprocess.run(cmd, check=True)
print('wrote', out, f'{total:.1f}s')
