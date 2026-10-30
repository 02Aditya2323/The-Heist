import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ten 48×64 cells per facing: idle A/B, then eight walk poses. Feet anchor (24,54).
// Original vector artwork, rasterized once by the browser and shared by all players.
const shape = (tag, attrs) => `<${tag} ${attrs}/>`;
function operator(facing, frame) {
  const side = facing >= 2, back = facing === 1;
  const walk = frame >= 2, pose = frame - 2;
  const swing = walk ? [0,3.9,5.5,3.9,0,-3.9,-5.5,-3.9][pose] : 0;
  const bob = walk ? -Math.abs(Math.sin(pose*Math.PI/4))*1.4 : frame === 1 ? -.4 : 0;
  const head = '#c8997f', ink = '#09131e', suit = '#203443', light = '#385465', cyan = '#70d7df';
  let s = '';
  const path = (d, fill, stroke = ink, width = 1.2) => { s += shape('path', `d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`); };
  const ellipse = (cx,cy,rx,ry,fill) => { s += shape('ellipse',`cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"`); };
  // Two articulated legs, separated at the knees. Opposing foot lift reads at native size.
  if (side) {
    path(`M21 39 Q18 44 ${21-swing} ${49-Math.abs(swing)} L${24-swing} ${51-Math.abs(swing)} L26 41Z`, '#132632');
    path(`M24 39 Q29 44 ${26+swing} ${50-Math.max(0,-swing)} L${30+swing} ${52-Math.max(0,-swing)} L31 50 L28 39Z`, suit);
    path(`M${20-swing} ${49-Math.abs(swing)} h5 l2 3 h-8Z`, '#344d5b');
    path(`M${25+swing} ${50-Math.max(0,-swing)} h5 l3 3 h-9Z`, '#405c69');
  } else {
    path(`M17 38 L17 ${49+swing} Q19 ${52+swing} 23 ${50+swing} L24 40Z`, suit);
    path(`M25 40 L25 ${50-swing} Q29 ${52-swing} 31 ${49-swing} L30 38Z`, '#182c39');
    path(`M17 ${48+swing} L22 ${48+swing} L23 ${53+swing} H16Z`, '#0a1621');
    path(`M26 ${48-swing} H31 L32 ${53-swing} H25Z`, '#0a1621');
    path(`M18 ${51+swing} h3 M27 ${51-swing} h3`, 'none', '#8da7b1', 1.1);
  }
  s += `<g transform="translate(0 ${bob})">`;
  if (side) {
    path('M19 23 Q22 20 27 23 L29 39 Q24 42 19 38Z', suit);
    path('M17 24 L19 25 L19 35 L15 34 L15 27Z', '#142632');
    path(`M25 25 Q30 29 ${27-swing/2} ${36+swing/2} L${24-swing/2} ${36+swing/2} L24 28Z`, light);
    ellipse(25-swing/2,37+swing/2,1.7,2,head);
    path('M20 24 L23 25 L23 34', 'none', '#5cabb7', 1);
    path('M20 14 Q19 9 24 9 Q29 9 30 14 L32 19 L29 20 Q28 25 24 24 L21 21Z', head);
    path('M19 17 Q16 11 21 8 Q28 5 30 13 L26 12 L23 15 L23 20 L20 21Z', '#122431');
    path('M25 16 L30 16', 'none', cyan, 1.4);
    path('M20 20 L23 22', 'none', '#648392', 1);
    ellipse(24,18,1.2,1.5,'#b98a72');
  } else {
    path(`M17 24 Q12 24 13 ${34-swing/2} L16 ${36-swing/2} L19 27Z`, suit);
    path(`M30 24 Q35 24 35 ${34+swing/2} L32 ${36+swing/2} L29 27Z`, '#182c39');
    ellipse(14.7,36-swing/2,1.7,2,back?'#314754':head);
    ellipse(33.3,36+swing/2,1.7,2,back?'#314754':head);
    path('M19 22 Q24 20 29 22 L31 28 L30 40 Q24 42 18 40 L17 28Z', suit);
    if (back) {
      path('M20 25 Q24 23 28 25 L28 35 Q24 37 20 35Z','#142935');
      path('M22 26 H26 M22 29 H26','none','#478798',1);
    } else {
      path('M19 24 L23 26 L24 35 L20 34Z',light);
      path('M28 24 L25 27 L25 35 L29 33Z','#2a4352');
      path('M20 24 L22 25 M27 25 L29 24','none',cyan,1.6);
      path('M24 27 V35','none','#0b1b27',1);
      path('M25 28 H28','none','#7da5af',.8);
    }
    path('M18 38 H30','none','#091621',2);
    path('M22 38 H25','none','#768c96',1.2);
    path('M21 20 L21 24 Q24 26 27 24 L27 20Z',back?'#172b38':head);
    path('M17 13 Q17 7 24 7 Q31 7 31 13 L30 20 Q24 26 18 20Z',back?'#172c3a':head);
    path('M17 16 Q15 8 22 6 Q31 5 32 13 L29 15 L28 11 Q22 14 19 12 L19 18Z','#101e2b');
    if (!back) {
      path('M20 16 L23 16 M26 16 H28','none','#14212b',1);
      path('M22 21 Q24 22 26 21','none','#906c5d',.7);
      path('M17 17 L19 17','none',cyan,1.5);
    } else path('M19 17 Q24 20 29 17','none','#3f6574',1);
  }
  s += '</g>';
  return facing === 3 ? `<g transform="translate(48 0) scale(-1 1)">${s}</g>` : s;
}
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="256" viewBox="0 0 480 256"><title>Veyra field operator: front, back, right, left; idle A/B and walk 1–8</title>';
for (let row=0;row<4;row++) for(let frame=0;frame<10;frame++) svg += `<g data-frame="${row}:${frame}" transform="translate(${frame*48} ${row*64})">${operator(row,frame)}</g>`;
svg += '</svg>';
writeFileSync(fileURLToPath(new URL('../apps/client/public/art/operators/operator-sheet.svg',import.meta.url)),svg);
