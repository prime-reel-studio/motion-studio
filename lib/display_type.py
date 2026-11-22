#!/usr/bin/env python3
"""Shape short display beats once with HarfBuzz/FriBidi via Pillow/RAQM.
No shell commands, network calls or text interpolation into filters.
"""
import json, math, os, re, sys, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter, features

if not features.check('raqm'):
    raise RuntimeError('Arabic display rendering requires Pillow with RAQM')

cfg = json.load(open(sys.argv[1], encoding='utf-8'))
W, H, duration = int(cfg['W']), int(cfg['H']), float(cfg['duration'])
words = re.findall(r'\S+', cfg.get('text', ''))
font_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fonts', 'NotoSansArabic-Black.ttf')
rtl = bool(re.search('[\u0600-\u08ff]', cfg.get('text', '')))
RAQM = ImageFont.Layout.RAQM if hasattr(ImageFont, 'Layout') else ImageFont.LAYOUT_RAQM
latin_font = os.path.join(os.path.dirname(font_path), 'DejaVuSans-Bold.ttf')
if not rtl: font_path = latin_font
opts = {'direction': 'rtl' if rtl else 'ltr', 'language': 'ar' if rtl else 'en'}
idx = int(cfg.get('index', 0))
layout = idx % 3
ink, accent = cfg['ink'], cfg['accent']
media = cfg.get('media', False)
if media:
    ink, accent = '#FFFFFF', '#F6CE5A'
# Two-word beats, with each new word revealed separately. No sentence blocks.
groups = [words[i:i+2] for i in range(0, len(words), 2)]
available = max(.3, duration - .38)
word_span = available / max(1, len(words))
manifest = []
cursor = 0
for gi, group in enumerate(groups):
    stacked = (len(group) == 2 and (layout == 2 or len(' '.join(group)) > 14))
    max_width = W * (.78 if layout == 1 else .86)
    size = round(min(W * (.28 if stacked or len(group) == 1 else .205), H * .20))
    full_lines = group if stacked else [' '.join(group)]
    while size > 28:
        font = ImageFont.truetype(font_path, size, layout_engine=RAQM)
        bounds = [font.getbbox(line, **opts) for line in full_lines]
        if max(b[2]-b[0] for b in bounds) <= max_width:
            break
        size -= 3
    # Shared font size within the beat prevents older words shrinking on reveal.
    for revealed in range(1, len(group)+1):
        visible = group[:revealed]
        lines = visible if stacked else [' '.join(visible)]
        boxes = [font.getbbox(line, **opts) for line in lines]
        line_heights = [b[3]-b[1] for b in boxes]
        line_gap = int(size * .10)
        pad = max(18, round(W*.022))
        width = max(b[2]-b[0] for b in boxes) + 2*pad
        height = sum(line_heights) + line_gap*(len(lines)-1) + 2*pad
        image = Image.new('RGBA', (width, height), (0,0,0,0))
        draw = ImageDraw.Draw(image)
        y = pad
        for li, (line, box) in enumerate(zip(lines, boxes)):
            text_width = box[2]-box[0]
            x = width-pad-text_width if layout == 1 else (width-text_width)//2
            # Alternate whole-beat color, not a wall of karaoke text.
            color = accent if (gi+li) % 2 else ink
            draw.text((x-box[0], y-box[1]), line, font=font, fill=color,
                      stroke_width=max(2,round(W*.004)) if media else 0,
                      stroke_fill=(0,0,0,220), **opts)
            y += line_heights[li] + line_gap
        name = os.path.join(cfg['outDir'], 'type_%s_%s_%s.png' % (idx, gi, revealed))
        image.save(name)
        start = .10 + cursor*word_span
        end = .10 + (cursor+1)*word_span
        if layout == 1:
            x = round(W*.90-width)
            center_y = H*(.33 if gi%2 == 0 else .61)
        else:
            x = (W-width)//2
            center_y = H*((.47 if gi%2 == 0 else .60) if layout == 0 else .48)
        if cfg.get('logo'):
            center_y = H*.77
        y = round(center_y-height/2)
        y = min(max(round(H*.13), y), round(H*.83)-height)
        manifest.append({'file': name, 'start': round(start,4), 'end': round(end,4),
                         'x': x, 'y': y, 'wordCount': revealed,
                         'entrance': (idx+gi)%3})
        cursor += 1
credit = cfg.get('credit') or {}
if credit.get('provider') == 'Wikimedia Commons':
    # Persistent attribution survives posting, alongside the downloadable full credits.
    font = ImageFont.truetype(latin_font, max(22, round(W*.030)), layout_engine=RAQM)
    lines = textwrap.wrap('Photo: ' + credit.get('author',''), width=46)[:3]
    lines += [credit.get('license','') + ' | cropped & animated', credit.get('licenseUrl','').replace('https://','').replace('http://','')]
    lh = round(W*.044)
    img = Image.new('RGBA',(round(W*.94), lh*len(lines)+28),(0,0,0,145))
    draw = ImageDraw.Draw(img)
    for n,line in enumerate(lines):
        draw.text((14, 10+n*lh),line,font=font,fill='white',direction='ltr')
    name = os.path.join(cfg['outDir'], 'credit_%s.png' % idx)
    img.save(name)
    manifest.append({'file':name,'start':0,'end':duration,'x':round(W*.03),'y':round(H*.95)-img.height,'wordCount':0,'entrance':3})
print(json.dumps(manifest))
