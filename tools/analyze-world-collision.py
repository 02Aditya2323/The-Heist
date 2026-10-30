"""Supervised OpenCV collision authoring, using ORIGINAL source pixels.

An image is not a semantic game map: neon glass, roofs and water share colors.
Reviewed floor traces and forbidden footprints are therefore the authority.
OpenCV rasterizes these at native resolution, checks a 12px standing-foot disc,
measures HSV/edge support and connected components, and exports review overlays.
Color classification never overrides a forbidden building/water footprint.
Only the resulting small tile rows ship to the client/server; CV runs offline.
"""
import hashlib
import argparse
import json
from pathlib import Path
import cv2
import numpy as np

root=Path(__file__).resolve().parents[1]
args=argparse.ArgumentParser();args.add_argument('--v2',action='store_true');args.add_argument('--scenes');options=args.parse_args()
prefix='art-world-v2' if options.v2 else 'art-world'
layout_path=root/f'maps/{prefix}.layout.json'
obstacle_path=root/f'maps/{prefix}.obstacles.json'
layout=json.loads(layout_path.read_text(encoding='utf-8'))
obstacles=json.loads(obstacle_path.read_text(encoding='utf-8'))['scenes']
tile=layout['tileSize']; w=layout['sceneWidth']*tile; h=layout['sceneHeight']*tile
out=root/'screenshots'/('collision-audit-v2' if options.v2 else 'collision-audit'); out.mkdir(parents=True,exist_ok=True)
rows_by_scene={}; reports=[]; thumbs=[]
source_image_hashes={s['id']:hashlib.sha256((root/layout.get('sourceRoot','THE_HEIST_ZERO_HOUR_Visual_Reference_Pack')/s['source']).read_bytes()).hexdigest() for s in layout['scenes'] if not options.scenes or s['id'] in options.scenes.split(',')}
kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13))
for scene in layout['scenes']:
    if options.scenes and scene['id'] not in options.scenes.split(','):continue
    source=root/layout.get('sourceRoot','THE_HEIST_ZERO_HOUR_Visual_Reference_Pack')/scene['source']
    img=cv2.imread(str(source))
    if img is None or img.shape[0]<h or img.shape[1]<w:raise RuntimeError(f'Missing or insufficient native-resolution artwork: {source}')
    img=img[:h,:w]
    floor=np.zeros((h,w),np.uint8); forbidden=np.zeros_like(floor)
    for polygon in scene.get('floorPolygons',[]):cv2.fillPoly(floor,[np.array(polygon,np.int32)],255)
    for route in scene['routes']:
        points=np.array(route['points'],np.int32)
        cv2.polylines(floor,[points],False,255,round(route['radius']*2),cv2.LINE_8)
        for x,y in points: cv2.circle(floor,(int(x),int(y)),round(route['radius']),255,-1)
    for obstacle in obstacles.get(scene['id'],[]):
        cv2.fillPoly(forbidden,[np.array(obstacle['points'],np.int32)],255)
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV)
    if scene.get('extractFloorFromImage'):
        # New art was specifically generated with neutral-grey pavement and saturated
        # water/vegetation. Use ACTUAL source pixels, not the pre-generation guide.
        # Reviewed footprints still prohibit roofs even when metal resembles paving.
        saturation=cv2.medianBlur(hsv[:,:,1],15);value=cv2.medianBlur(hsv[:,:,2],15)
        floor=((saturation<=115)&(value>=60)).astype(np.uint8)*255
        floor=cv2.morphologyEx(floor,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
        floor=cv2.morphologyEx(floor,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
    # Human-reviewed lit paving patches may recover a color-classifier false negative.
    # The dilated hard building/water exclusions are applied afterward and always win.
    for polygon in scene.get('floorOverrides',[]):cv2.fillPoly(floor,[np.array(polygon,np.int32)],255)
    safe=cv2.erode(floor,kernel)
    exclusion=cv2.dilate(forbidden,kernel)
    safe[exclusion>0]=0
    water_like=cv2.inRange(hsv,np.array([83,105,20]),np.array([114,255,220]))
    edges=cv2.Canny(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY),70,150)
    grid=np.ones((layout['sceneHeight'],layout['sceneWidth']),np.uint8)
    possible_water=[]
    for y in range(grid.shape[0]):
        for x in range(grid.shape[1]):
            px=x*tile+tile//2;py=y*tile+tile//2
            if safe[py,px]:
                grid[y,x]=0
                patch=water_like[py-6:py+7,px-6:px+7]
                if float(np.mean(patch>0))>.7: possible_water.append([x,y])
    if scene.get('extractFloorFromImage'):
        grid[0,:]=1;grid[-1,:]=1;grid[:,0]=1;grid[:,-1]=1
        count,labels,stats,_=cv2.connectedComponentsWithStats((grid==0).astype(np.uint8),connectivity=4)
        if count>1:
            largest=1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]));grid[(labels!=largest)]=1
    count,labels,stats,_=cv2.connectedComponentsWithStats((grid==0).astype(np.uint8),connectivity=4)
    component_sizes=sorted([int(v) for v in stats[1:,cv2.CC_STAT_AREA]],reverse=True)
    rows_by_scene[scene['id']]=[''.join(str(int(v)) for v in row) for row in grid]
    overlay=img.copy(); tint=np.zeros_like(img)
    tint[floor>0]=(35,115,35); tint[forbidden>0]=(40,40,210)
    marked=(floor>0)|(forbidden>0)
    overlay[marked]=cv2.addWeighted(img,.55,tint,.45,0)[marked]
    for y,x in np.argwhere(grid==0):
        cv2.rectangle(overlay,(int(x)*tile,int(y)*tile),(int(x+1)*tile-1,int(y+1)*tile-1),(130,235,135),1)
    for o in scene['objects']:
        cv2.circle(overlay,tuple(o['point']),8,(255,255,255),2)
    for link in layout['links']:
        points=[]
        if link['a']==scene['id']:points.append(link['pointA'])
        if link['b']==scene['id']:points.append(link['pointB'])
        if link['connector']==scene['id']:points.extend([link['start'],link['end']])
        for p in points:cv2.circle(overlay,tuple(p),10,(0,220,255),2)
    cv2.imwrite(str(out/f"{scene['id']}.jpg"),overlay,[cv2.IMWRITE_JPEG_QUALITY,93])
    thumb=cv2.resize(overlay,(550,307)); panel=np.zeros((335,550,3),np.uint8);panel[:307]=thumb
    cv2.putText(panel,f"{scene['id']} | {int(np.sum(grid==0))} floor tiles | {count-1} components",(8,326),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1,cv2.LINE_AA);thumbs.append(panel)
    reports.append({'id':scene['id'],'source':scene['source'],'walkableTiles':int(np.sum(grid==0)),
      'components':component_sizes,'reviewedObstacles':len(obstacles.get(scene['id'],[])),
      'waterColorReviewTiles':possible_water,'floorEdgeDensity':round(float(np.mean(edges[floor>0]>0)),3)})
digest=hashlib.sha256(layout_path.read_bytes()+obstacle_path.read_bytes()+json.dumps(source_image_hashes,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()
if options.scenes:prefix+='-partial'
(root/f'maps/{prefix}.collision.json').write_text(json.dumps({'version':layout['version'],'sourceHash':digest,'sourceImageHashes':source_image_hashes,'footRadiusPixels':6,'scenes':rows_by_scene},indent=2)+'\n')
(root/f'maps/{prefix}.collision-report.json').write_text(json.dumps({'version':layout['version'],'sourceHash':digest,'method':'Reviewed native-pixel floor/obstacle masks; OpenCV morphology, HSV diagnostics and connected components. Unknown surfaces blocked.','scenes':reports},indent=2)+'\n')
sheet=np.zeros((((len(thumbs)+2)//3)*335,3*550,3),np.uint8)
for i,p in enumerate(thumbs):sheet[(i//3)*335:(i//3+1)*335,(i%3)*550:(i%3+1)*550]=p
cv2.imwrite(str(root/f'screenshots/complete-world-collision-audit{"-v2" if options.v2 else ""}.jpg'),sheet,[cv2.IMWRITE_JPEG_QUALITY,95])
print(json.dumps({'version':layout['version'],'scenes':reports},indent=2))
