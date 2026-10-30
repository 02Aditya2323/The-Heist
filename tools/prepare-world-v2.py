"""Create inspectable geometry guides before generating any production map art."""
import json
from pathlib import Path
import cv2
import numpy as np
root=Path(__file__).resolve().parents[1]
plan=json.loads((root/'maps/art-world-v2.plan.json').read_text(encoding='utf-8'))
old=json.loads((root/'maps/art-world.layout.json').read_text(encoding='utf-8'))
old_by_id={s['id']:s for s in old['scenes']}
descriptions={o['id']:o for s in old['scenes'] for o in s['objects']}
out=root/'docs/generated-world-v2'; out.mkdir(parents=True,exist_ok=True)
tile=plan['tileSize']; w=plan['width']*tile;h=plan['height']*tile
def pixel(p):return [int((v+.5)*tile) for v in p]
def polygon(r):
    x,y,rw,rh=r;return [[x*tile,y*tile],[(x+rw)*tile,y*tile],[(x+rw)*tile,(y+rh)*tile],[x*tile,(y+rh)*tile]]
layout={'version':plan['version'],'tileSize':tile,'sceneWidth':plan['width'],'sceneHeight':plan['height'],'sourceRoot':'.','assetPrefix':'v2-','spawnPoint':[848,592],'scenes':[],'links':[],'streets':[]}
obstacles={'note':'Explicit planned native-pixel roof/water boundaries; review against regenerated artwork before activation.','scenes':{}}
prompts=[];thumbs=[]
for spec in plan['districts']+plan['connectors']:
    is_connector='orientation' in spec
    roofs=spec.get('buildings',[])
    ground=list(spec.get('ground',[]))
    if is_connector:
        if spec['orientation']=='horizontal':
            ground=[[0,13,52,5],[17,0,4,29],[32,0,4,29]]
            roofs=[{'id':spec['id']+'-info','name':'Route information kiosk','rect':[8,9,6,3],'door':[11,12]},
                   {'id':spec['id']+'-food','name':'Food stall','rect':[39,9,7,3],'door':[42,12],'decorative':True},
                   {'id':spec['id']+'-rest','name':'Rest area shelter','rect':[23,21,7,3],'door':[26,24],'decorative':True}]
            ground.append([21,18,11,9])
        else:
            ground=[[24,0,5,29],[8,10,36,3],[8,20,36,3]]
            roofs=[{'id':spec['id']+'-info','name':'Route information kiosk','rect':[13,7,5,3],'door':[15,10]},
                   {'id':spec['id']+'-food','name':'Food stall','rect':[34,17,7,3],'door':[37,20],'decorative':True},
                   {'id':spec['id']+'-rest','name':'Rest area shelter','rect':[12,17,6,3],'door':[15,20],'decorative':True}]
    scene={'id':spec['id'],'name':spec['name'],'kind':'connector' if is_connector else 'district','origin':spec['origin'],
           'color':spec.get('color',old_by_id[spec['id']]['color']),'source':f"docs/generated-world-v2/{spec['id']}.png",'focus':pixel([26,15]),'routes':[],
           'floorPolygons':[],'objects':[],'extractFloorFromImage':True}
    for b in roofs:
        dx,dy=b['door'];ground.append([dx-1,dy,3,2])
        if not b.get('decorative'):
            original=descriptions.get(b['id'],{})
            scene['objects'].append({'id':b['id'],'name':b['name'],'point':pixel([dx,dy+1]),'action':original.get('action','info'),
               'description':original.get('description',f"This is the {spec['name']} route. Follow the signed city-map links to travel between districts.")})
    scene['floorPolygons']=[polygon(r) for r in ground]
    obstacles['scenes'][scene['id']]=[{'name':b['name'],'kind':'prop' if b.get('shape') in ['console','monument'] else 'building','points':polygon(b['rect'])} for b in roofs]
    for water in spec.get('water',[]):obstacles['scenes'][scene['id']].append({'name':'Harbor water','kind':'water','points':polygon(water)})
    layout['scenes'].append(scene)
    guide=np.full((h,w,3),(30,30,30),np.uint8)
    for r in ground:cv2.fillPoly(guide,[np.array(polygon(r),np.int32)],(145,145,145))
    for water in spec.get('water',[]):cv2.fillPoly(guide,[np.array(polygon(water),np.int32)],(145,70,20))
    for b in roofs:
        cv2.fillPoly(guide,[np.array(polygon(b['rect']),np.int32)],(55,75,110))
        x,y,rw,rh=b['rect'];cv2.putText(guide,b['name'],(x*tile+5,int((y+rh/2)*tile)),cv2.FONT_HERSHEY_SIMPLEX,.55,(255,255,255),1,cv2.LINE_AA)
        cv2.circle(guide,tuple(pixel(b['door'])),9,(40,230,255),-1)
    cv2.imwrite(str(out/f"{spec['id']}-guide.png"),guide)
    prompt=f"Use case: stylized-concept. Asset type: production playable 2D RPG map, {spec['name']}. Image 1 is STYLE REFERENCE ONLY. Image 2 is the EXACT GEOMETRY GUIDE, not an edit target. Generate a NEW scene matching the guide positions and footprint sizes precisely, at 1664x928 landscape dimensions if possible. DO NOT reuse the reference layout, arrows or lettering. Parallel top-down RPG camera, roofs visible, south-facing facades, consistent house scale and clean foot-centered walking surfaces. Theme: {spec['theme']} Grey guide surfaces must become uninterrupted readable worn neutral-grey pavement with subtle curb lighting. Brown guide rectangles are the ONLY solid building/prop plots; no building, planter, railing, kiosk, stairs edge or water may spill onto grey road regions. Yellow dots are door/approach locations; represent clear front doors/steps, NOT dots. Blue areas, if present, are water and must remain water. Dark unused areas may be non-walkable decorative side gardens, city edge roof clusters or fenced docks. Buildings must fit entirely within their planned solid plots, including facades and stairs. Guide building labels identify the function: represent it through distinctive architecture and icons on the structure, not text. Main streets are broad, connected, unobstructed and at least 3 operator widths. A tiny 32px operator would feel correctly scaled here. Preserve the style reference's dark steel material details, amber domestic light, restrained district accent colors, roof vents, subtle neon; avoid photoreal perspective. No characters, cars or road clutter. ABSOLUTELY NO text, labels, street names, UI, legends, arrows, numbers, watermarks, border frames, vignette. This is game art, not a poster or a concept guide."
    prompts.append({'id':spec['id'],'prompt':prompt,'references':[str(root/'THE_HEIST_ZERO_HOUR_Visual_Reference_Pack'/old_by_id[spec['id']]['source']),str(out/f"{spec['id']}-guide.png")]})
    p=np.zeros((335,550,3),np.uint8);p[:307]=cv2.resize(guide,(550,307));cv2.putText(p,spec['id'],(8,326),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1);thumbs.append(p)
by_id={s['id']:s for s in layout['scenes']}
for link in plan['links']:
    c=next(c for c in plan['connectors'] if c['id']==link['connector'])
    a=by_id[link['a']];b=by_id[link['b']]
    if c['orientation']=='horizontal':
        positive=a['origin'][0]<b['origin'][0]; start=[1,15] if positive else [50,15];end=[50,15] if positive else [1,15]
    else:
        positive=a['origin'][1]<b['origin'][1]; start=[26,1] if positive else [26,27];end=[26,27] if positive else [26,1]
    layout['links'].append({**link,'pointA':pixel(link['pointA']),'pointB':pixel(link['pointB']),'start':pixel(start),'end':pixel(end)})
# Six actual residential neighborhoods, not a claim that ownership/economy is implemented.
# The generated block has 15 discrete front doors; addresses are assigned in structured data.
home_centers=[160,500,840,1180,1515]
home_bounds=[(40,288),(375,625),(715,970),(1060,1307),(1390,1638)]
home_rows=[(50,237,292),(335,532,580),(625,828,875)]
for ward in range(6):
    letter=chr(65+ward);id=f'homes-{letter.lower()}'
    scene={'id':id,'name':f'Undercity · Ward {letter}','kind':'neighborhood','parentId':'under','origin':[70+(ward%3)*70,300+(ward//3)*60],
           'color':'#f0b36f','source':'docs/generated-world-v2/homes.png','asset':'homes','focus':[840,580],
           'floorOverrides':[[[644,0],[692,0],[692,928],[644,928]],[[312,0],[350,0],[350,928],[312,928]],[[988,0],[1036,0],[1036,928],[988,928]],[[1328,0],[1376,0],[1376,928],[1328,928]]],
           'extractFloorFromImage':True,'routes':[{'points':[[16,y],[1632,y]],'radius':42} for y in [292,580,875]]+
                    [{'points':[[x,16],[x,896]],'radius':34 if x not in [16,1632] else 16} for x in [16,333,670,1010,1350,1632]],'floorPolygons':[],'objects':[]}
    blocks=[]
    for row,(top,bottom,door_y) in enumerate(home_rows):
        for col,center in enumerate(home_centers):
            number=ward*15+row*5+col+1;address=f'H{number:03d}'
            scene['objects'].append({'id':'home-'+address.lower(),'name':f'Home site {address}','point':[center,door_y],
              'action':'homes','homeAddress':address,'description':f'{address}, Undercity Ward {letter}. A distinct residential Home site. Player ownership, protected disconnect grace, burglary locks and balances require the authoritative Home/economy service; they are not active in this build.'})
            left,right=home_bounds[col];blocks.append({'name':address,'kind':'building','points':[[left,top],[right,top],[right,bottom],[left,bottom]]})
    layout['scenes'].append(scene);obstacles['scenes'][id]=blocks
def street(id,a,pa,b,pb):layout['streets'].append({'id':id,'a':a,'pointA':pa,'b':b,'pointB':pb})
street('homes-entry','under',pixel([26,27]),'homes-b',[670,48])
for a,b in [('a','b'),('b','c'),('d','e'),('e','f')]:street(f'homes-{a}-{b}',f'homes-{a}',[1616,580],f'homes-{b}',[48,580])
for a,b in [('a','d'),('b','e'),('c','f')]:street(f'homes-{a}-{b}',f'homes-{a}',[670,880],f'homes-{b}',[670,48])
review_path=root/'maps/art-world-v2.review.json'
if review_path.exists():
    review=json.loads(review_path.read_text(encoding='utf-8'))['scenes']
    for scene in layout['scenes']:
        r=review.get(scene['id'],{})
        for obj in scene['objects']:
            if obj['id'] in r.get('points',{}):obj['point']=r['points'][obj['id']]
        if 'obstacles' in r:obstacles['scenes'][scene['id']]=r['obstacles']
        if 'blocks' in r:obstacles['scenes'][scene['id']]=[{'name':n,'kind':k,'points':[[x,y],[x+rw,y],[x+rw,y+rh],[x,y+rh]]} for n,k,x,y,rw,rh in r['blocks']]
        if 'foregroundRects' in r:scene['foregroundRects']=r['foregroundRects']
        if 'floorOverrides' in r:scene['floorOverrides']=r['floorOverrides']
        for obj in scene['objects']:obj['point']=[int(v//tile*tile+tile/2) for v in obj['point']]
    # Explicit visual-review gate overrides update BOTH sides of the reciprocal pair.
    gate_overrides={key:value for r in review.values() for key,value in r.get('gates',{}).items()}
    for link in layout['links']:
        r=review.get(link['connector'],{})
        if 'roadY' in r:link['start'][1]=r['roadY'];link['end'][1]=r['roadY']
        for suffix,field in [('from-a','pointA'),('back-a','start'),('to-b','end'),('back-b','pointB')]:
            key=link['connector']+'-'+suffix
            if key in gate_overrides:link[field]=gate_overrides[key]
(root/'maps/art-world-v2.layout.json').write_text(json.dumps(layout,indent=2)+'\n')
(root/'maps/art-world-v2.obstacles.json').write_text(json.dumps(obstacles,indent=2)+'\n')
(out/'generation-prompts.json').write_text(json.dumps(prompts,indent=2)+'\n')
sheet=np.zeros((5*335,3*550,3),np.uint8)
for i,p in enumerate(thumbs):sheet[(i//3)*335:(i//3+1)*335,(i%3)*550:(i%3+1)*550]=p
cv2.imwrite(str(out/'geometry-guides.jpg'),sheet)
print('Prepared 13 geometry guides, prompts and staged layouts; live map not changed.')
