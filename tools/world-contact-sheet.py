"""Offline source review; never edits the originals."""
import json
from pathlib import Path
import cv2
import numpy as np
root=Path(__file__).resolve().parents[1]
layout=json.loads((root/'maps/art-world.layout.json').read_text())
sheet=np.zeros((5*300,3*550,3),dtype=np.uint8)
for i,s in enumerate(layout['scenes']):
    img=cv2.imread(str(root/'THE_HEIST_ZERO_HOUR_Visual_Reference_Pack'/s['source']))
    preview=cv2.resize(img,(550,270))
    x=(i%3)*550;y=(i//3)*300
    sheet[y:y+270,x:x+550]=preview
    cv2.putText(sheet,s['id']+' - '+s['name'],(x+8,y+291),cv2.FONT_HERSHEY_SIMPLEX,.55,(255,255,255),1,cv2.LINE_AA)
cv2.imwrite(str(root/'screenshots/world-source-contact.png'),sheet)
