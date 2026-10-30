"""Small OpenCV overview previews only; full-resolution originals stay unchanged."""
import json
import argparse
from pathlib import Path
import cv2

root = Path(__file__).resolve().parents[1]
args=argparse.ArgumentParser();args.add_argument('--v2',action='store_true');options=args.parse_args()
prefix='art-world-v2' if options.v2 else 'art-world'
layout = json.loads((root / f'maps/{prefix}.layout.json').read_text(encoding='utf-8'))
out = root / 'apps/client/public/art/scenes'
out.mkdir(parents=True, exist_ok=True)
for scene in layout['scenes']:
    image = cv2.imread(str(root / layout.get('sourceRoot','THE_HEIST_ZERO_HOUR_Visual_Reference_Pack') / scene['source']))
    if image is None:
        raise RuntimeError(f"Missing source: {scene['source']}")
    # Same map crop as the gameplay renderer, then downsample only for the world overview.
    crop = image[:layout['sceneHeight'] * layout['tileSize'], :layout['sceneWidth'] * layout['tileSize']]
    width = 384
    height = round(width * crop.shape[0] / crop.shape[1])
    preview = cv2.resize(crop, (width, height), interpolation=cv2.INTER_AREA)
    name=layout.get('assetPrefix','')+scene.get('asset',scene['id'])
    if not cv2.imwrite(str(out / f"{name}-preview.webp"), preview, [cv2.IMWRITE_WEBP_QUALITY, 88]):
        raise RuntimeError(f"Could not save preview for {scene['id']}")
print(f"Prepared {len(layout['scenes'])} lightweight overview images. Original artwork unchanged.")
