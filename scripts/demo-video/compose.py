"""Join the recorded clips to the voiceover and burn the subtitles in.

Deliberately free of literal backslashes: every path that reaches ffmpeg or a
concat list is converted with fwd(), and the two escapes ASS and the subtitles
filter need are built from chr(92). Windows paths and shell heredocs each eat a
backslash, and between them they ate this file twice.
"""
import json, os, subprocess, textwrap

BS = chr(92)
NL = chr(10)
HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS, AUDIO = os.path.join(HERE, 'clips'), os.path.join(HERE, 'audio')
BUILD = os.path.join(HERE, 'build'); os.makedirs(BUILD, exist_ok=True)
OUT = os.path.join(HERE, 'jalin-demo.mp4')

# Playwright starts recording before the page has painted; the first frames are
# a white flash. Measured at 0.2s white and 1.0s painted, so drop a second.
HEAD = 0.95
W, H, FPS = 1920, 1080, 30

def fwd(p):
    return p.replace(os.sep, '/')

def ff(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + args, check=True)

def probe_duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                          '-of', 'default=nw=1:nk=1', path], capture_output=True, text=True)
    return float(out.stdout.strip())

def ass_time(t):
    h, rem = divmod(max(t, 0), 3600)
    m, s = divmod(rem, 60)
    return '%d:%02d:%05.2f' % (int(h), int(m), s)

scenes = json.load(open(os.path.join(HERE, 'timed.json'), encoding='utf-8'))

# --- subtitles -------------------------------------------------------------
events, offset = [], 0.0
for s in scenes:
    cues = json.load(open(os.path.join(AUDIO, s['id'] + '.json'), encoding='utf-8'))
    for cue in cues:
        text = (BS + 'N').join(textwrap.wrap(cue['w'].strip(), 62))
        start, end = offset + cue['t'], offset + cue['t'] + cue['d']
        events.append('Dialogue: 0,%s,%s,Sub,,0,0,0,,%s' % (ass_time(start), ass_time(end), text))
    offset += s['duration']

header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: %d' % W, 'PlayResY: %d' % H,
    'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    ('Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour,'
     ' Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'),
    # BorderStyle 3 draws a box, and with libass it is OutlineColour that paints
    # it while Outline sets its padding. Left at 0 the box has no width and the
    # page reads straight through the captions.
    'Style: Sub,Segoe UI,44,&H00FFFFFF,&HC0100C08,&HC0100C08,-1,3,10,0,2,220,220,64,1', '',
    '[Events]',
    ('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'),
]
ass = os.path.join(BUILD, 'subs.ass')
open(ass, 'w', encoding='utf-8').write(NL.join(header + events) + NL)
print('%d subtitle cues, %.1fs of narration' % (len(events), offset))

# --- clips, each cut to exactly the length of its narration ----------------
vlist, alist = [], []
for s in scenes:
    mp4 = os.path.join(BUILD, s['id'] + '.mp4')
    clip = os.path.join(CLIPS, s['id'] + '.webm')
    # Never ask for more than the clip holds: a scene whose recording ran short
    # keeps its narration and loses the head trim, rather than failing the build.
    head = max(0.0, min(HEAD, probe_duration(clip) - s['duration'] - 0.05))
    if head < HEAD:
        print('  %s: head trim %.2fs (clip is tight)' % (s['id'], head))
    ff(['-ss', str(head), '-i', clip,
        '-t', str(s['duration']),
        '-vf', 'scale=%d:%d:flags=lanczos,fps=%d,format=yuv420p' % (W, H, FPS),
        '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', mp4])
    vlist.append(mp4)
    alist.append(os.path.join(AUDIO, s['id'] + '.mp3'))

def concat_list(paths, name):
    p = os.path.join(BUILD, name)
    open(p, 'w', encoding='utf-8').write(
        NL.join("file '" + fwd(x) + "'" for x in paths) + NL)
    return p

video = os.path.join(BUILD, 'video.mp4')
audio = os.path.join(BUILD, 'audio.m4a')
ff(['-f', 'concat', '-safe', '0', '-i', concat_list(vlist, 'v.txt'), '-c', 'copy', video])
ff(['-f', 'concat', '-safe', '0', '-i', concat_list(alist, 'a.txt'),
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', audio])

# --- burn the subtitles and mux -------------------------------------------
subs_filter = "subtitles='" + fwd(ass).replace(':', BS + ':') + "'"
ff(['-i', video, '-i', audio, '-vf', subs_filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', '-shortest', OUT])

probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'default=nw=1:nk=1', OUT], capture_output=True, text=True)
print(NL + OUT)
print('%.1fs   %.1f MB' % (float(probe.stdout.strip()), os.path.getsize(OUT) / 1e6))
