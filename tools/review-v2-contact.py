"""Source review pages; no modification of the generated game artwork."""
import json
from pathlib import Path
import cv2
import numpy as np
root=Path(__file__).resolve().parents[1]
l=json.loads((root/'maps/art-world-v2.layout.json').read_text())
scenes=[s for s in l['scenes'] if s['kind']!='neighborhood']
for page in range((len(scenes)+5)//6):
    group=scenes[page*6:page*6+6];canvas=np.zeros((3*325,2*550,3),np.uint8)
    for i,s in enumerate(group):
        img=cv2.imread(str(root/s['source']));p=cv2.resize(img,(550,307));x=(i%2)*550;y=(i//2)*325
        canvas[y:y+307,x:x+550]=p;cv2.putText(canvas,s['id'],(x+8,y+321),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1)
    cv2.imwrite(str(root/f'screenshots/regenerated-world-review-{page+1}.jpg'),canvas,[cv2.IMWRITE_JPEG_QUALITY,95])
