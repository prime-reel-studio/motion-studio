"""Picture-led recap renderer. All media are local user uploads, never remote URLs."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
import sys,json,subprocess,math,os,tempfile
cfg=json.load(open(sys.argv[1]));root=Path(cfg['uploads']);out=Path(cfg['output']);work=Path(cfg['work']);work.mkdir(parents=True,exist_ok=True)
W,H=1920,1080;fps=25;scenes=cfg['project']['scenes'];project=cfg['project'];fontpath=Path(__file__).parent.parent/'assets/fonts/NotoSansArabic-Black.ttf';fonts={};tiles={}
def text(im,s,x,y,size=48,color='#eee5d3',maxw=1740):
 s=str(s or '')[:240]
 if not s:return
 key=(s,size,color,maxw)
 if key not in tiles:
  while size>=18:
   if size not in fonts:fonts[size]=ImageFont.truetype(str(fontpath),size)
   f=fonts[size];bb=f.getbbox(s,direction='rtl',language='ar')
   if bb[2]-bb[0]<=maxw:break
   size-=2
  ti=Image.new('RGBA',(bb[2]-bb[0]+10,bb[3]-bb[1]+10));ImageDraw.Draw(ti).text((5-bb[0],5-bb[1]),s,font=f,fill=color,direction='rtl',language='ar');tiles[key]=ti
 ti=tiles[key];im.paste(ti,(round(x-ti.width/2),round(y-ti.height/2)),ti)
def local(name):
 p=root/Path(name).name
 if not p.is_file():raise ValueError('A media file is missing. Upload it again.')
 return p
length=sum(float(s['duration']) for s in scenes);voice=local(project['voiceover']);photos={};decoders={};starts=[];t=0
for i,s in enumerate(scenes):
 starts.append(t);t+=float(s['duration']);p=local(s['media']);s['_kind']='video' if p.suffix.lower() in ['.mp4','.webm','.mov','.mkv'] else 'image'
 if s['_kind']=='image':photos[i]=ImageOps.exif_transpose(Image.open(p)).convert('RGB')

def picture(i,lt):
 s=scenes[i];dur=float(s['duration']);crop=s.get('sourceCrop')
 if s['_kind']=='video':
  if i not in decoders:
   p=local(s['media']);vf=[]
   if crop:
    x,y,w,h=map(int,crop);vf.append(f'crop={w}:{h}:{x}:{y}')
   vf+=['scale=1920:808:force_original_aspect_ratio=decrease','pad=1920:808:(ow-iw)/2:(oh-ih)/2:black','setsar=1',f'fps={fps}']
   cmd=['ffmpeg','-v','error','-ss',str(float(s.get('trimStart',0))),'-i',str(p),'-an','-vf',','.join(vf),'-t',str(dur),'-f','rawvideo','-pix_fmt','rgb24','-threads','1','-']
   decoders[i]=[subprocess.Popen(cmd,stdout=subprocess.PIPE),None]
  proc,last=decoders[i];b=proc.stdout.read(W*808*3)
  if len(b)==W*808*3:last=Image.frombytes('RGB',(W,808),b);decoders[i][1]=last
  if last is None:raise ValueError('Video trim starts after the source ended.')
  pic=last
 else:
  src=photos[i]
  if crop:
   x,y,w,h=map(int,crop);src=src.crop((x,y,x+w,y+h))
  sw,sh=src.size;z=1+.045*min(1,lt/dur);cw=round(sw/z);ch=round(sh/z);x=(sw-cw)//2;y=(sh-ch)//2;src=src.crop((x,y,x+cw,y+ch));pic=ImageOps.contain(src,(W,808),Image.Resampling.BILINEAR)
 im=Image.new('RGB',(W,H),'#080a0b');im.paste(pic,((W-pic.width)//2,136+(808-pic.height)//2));d=ImageDraw.Draw(im)
 text(im,project.get('episodeLabel') or project.get('title','ملخص الحلقة'),1500,60,30,maxw=700)
 text(im,s.get('chapter','ملخص وتحليل'),960,60,28,maxw=600)
 text(im,'ملخص وتحليل',240,60,25,'#a5a5a3',400);d.line((65,112,1855,112),fill='#252c2b',width=2)
 text(im,'مقتطف متحرك' if s['_kind']=='video' else 'صورة مع تحريك',260,982,23,'#a5a5a3',430)
 text(im,s.get('caption') or s.get('text',''),1140,998,49,maxw=1320)
 d.line((640,1048,1800,1048),fill='#313632',width=2);d.line((640,1048,640+round(1160*min(1,lt/dur)),1048),fill='#bfa671',width=4)
 return im
cmd=['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(fps),'-i','-','-i',str(voice),'-map','0:v','-map','1:a','-af','apad,highpass=f=65,alimiter=limit=0.95:level=disabled','-t',str(length),'-c:v','libx264','-preset','veryfast','-crf','24','-maxrate','1800k','-bufsize','3600k','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-threads','2','-movflags','+faststart',str(out)]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
try:
 for n in range(math.ceil(length*fps)):
  t=n/fps;i=next((k for k in range(len(starts)-1,-1,-1) if t>=starts[k]),0)
  if i>0 and i-1 in decoders:
   proc,_=decoders.pop(i-1);proc.stdout.close();proc.terminate();proc.wait()
  p.stdin.write(picture(i,t-starts[i]).tobytes())
  if n%100==0:print(json.dumps({'progress':round(n/max(1,length*fps),3)}),flush=True)
 p.stdin.close()
 if p.wait()!=0:raise RuntimeError('Video encoder failed')
finally:
 for proc,_ in decoders.values():
  proc.stdout.close();proc.terminate();proc.wait()
print(json.dumps({'done':True,'duration':length}),flush=True)
