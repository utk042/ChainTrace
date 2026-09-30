"""Generate the narration with ElevenLabs, then rebuild the video.

usage: ELEVENLABS_API_KEY=... python elevenlabs_voice.py [voice_id]
Default voice: "Adam" (pNInz6obpgDQGcFmaJgB). Output: ChainTrace_demo_elevenlabs.mp4
"""
import json, os, sys, subprocess, urllib.request
D = os.path.dirname(os.path.abspath(__file__)) + '/'
key = os.environ['ELEVENLABS_API_KEY']
voice = sys.argv[1] if len(sys.argv) > 1 else 'pNInz6obpgDQGcFmaJgB'
out = D + 'voice_11labs'; os.makedirs(out, exist_ok=True)
lines = json.load(open(D + 'vo/lines.json'))
prev = None
for i, (lid, _, text) in enumerate(lines):
    text = text.replace('S I H 2 6 1 4 6', 'S-I-H 2-6-1-4-6').replace('N T R O', 'N-T-R-O').replace('A I powered', 'AI-powered') \
               .replace('C S V', 'CSV').replace('X M L', 'XML').replace('I P s', 'IPs').replace('P N G', 'PNG')
    body = {'text': text, 'model_id': 'eleven_multilingual_v2',
            'voice_settings': {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.15},
            'previous_text': lines[i-1][2] if i else None,
            'next_text': lines[i+1][2] if i + 1 < len(lines) else None}
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128',
        data=json.dumps(body).encode(), headers={'xi-api-key': key, 'content-type': 'application/json'})
    open(f'{out}/{lid}.mp3', 'wb').write(urllib.request.urlopen(req).read())
    print('voiced', lid)
subprocess.run([sys.executable, D + 'compose.py', out, D + 'ChainTrace_demo_elevenlabs.mp4'], check=True)
