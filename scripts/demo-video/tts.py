import asyncio, json, os, subprocess, sys
import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.environ.get('VOICE', 'en-US-AndrewMultilingualNeural')
RATE = os.environ.get('RATE', '-4%')

def duration(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', path],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())

async def main():
    scenes = json.load(open(os.path.join(HERE, 'scenes.json'), encoding='utf-8'))
    audio = os.path.join(HERE, 'audio'); os.makedirs(audio, exist_ok=True)
    total = 0.0
    for s in scenes:
        mp3 = os.path.join(audio, s['id'] + '.mp3')
        sub = os.path.join(audio, s['id'] + '.json')
        words = []
        comm = edge_tts.Communicate(s['text'], VOICE, rate=RATE)
        with open(mp3, 'wb') as f:
            async for chunk in comm.stream():
                if chunk['type'] == 'audio':
                    f.write(chunk['data'])
                elif chunk['type'] in ('SentenceBoundary', 'WordBoundary'):
                    # offsets arrive in 100-nanosecond ticks
                    words.append({'t': chunk['offset'] / 1e7,
                                  'd': chunk['duration'] / 1e7,
                                  'w': chunk['text']})
        json.dump(words, open(sub, 'w', encoding='utf-8'))
        s['audio'] = mp3
        s['duration'] = round(duration(mp3), 3)
        s['words'] = len(words)
        total += s['duration']
        print(f"{s['id']:<16} {s['duration']:6.2f}s  {len(words):3d} cues")
    json.dump(scenes, open(os.path.join(HERE, 'timed.json'), 'w', encoding='utf-8'), indent=1)
    print(f"\nTOTAL {total:.1f}s  ({total/60:.2f} min)")
    if total > 180:
        print('OVER three minutes - trim before rendering', file=sys.stderr)

asyncio.run(main())
