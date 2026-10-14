// Writes build/icon.svg: pixel art on a 32x32 grid after the main menu art of the map
// (the neon ring of the PIZZAPLEX sign, the cyan and pink arch, fire below).
// The grid keeps it sharp at 16 and 32 px. Then "npm.cmd run icon" makes icon.png and icon.ico.
//
// Usage (in the launcher folder):  node build/make-icon-svg.js

const fs = require('fs');
const path = require('path');

const G = 32;
const S = 8; // 256 px

// One character per pixel: . empty, W ring, P letter, C cyan, K pink, F/O/Y fire (dark, orange, yellow)
const art = [
  '................................',
  '................................',
  '..........CCCCCCCCCCC...........',
  '.......CCCKKKKKKKKKKKCCC........',
  '.....CCKKK...........KKKCC......',
  '....CKK.................KKC.....',
  '...CK.....................KC....',
  '..CK.......WWWWWWWWW.......KC...',
  '..CK......WW.......WW......KC...',
  '.CK......WW.........WW......KC..',
  '.CK.....WW...........WW.....KC..',
  '.CK.....W....PPPPP....W.....KC..',
  '.CK.....W....PP..PP...W.....KC..',
  '.CK.....W....PP..PP...W.....KC..',
  '.CK.....W....PPPPP....W.....KC..',
  '.CK.....W....PP.......W.....KC..',
  '.CK.....W....PP.......W.....KC..',
  '.CK.....WW...PP......WW.....KC..',
  '.CK......WW.........WW......KC..',
  '.CK.......WW.......WW.......KC..',
  '.CK........WWWWWWWWW........KC..',
  '.CK.........................KC..',
  '.CK..........F..............KC..',
  '.CK....F....FOF.......F.....KC..',
  '.F....FOF..FOYOF.....FOF...F.F..',
  'FOF..FOYOF.FOYOF..F.FOYOF.FOFOF.',
  'OYOFFOYYOFFOYYYOFFOFOYYYOFOYOYOF',
  'OYYOOYYYYOOYYYYYOOYOYYYYYOYYYYYO',
  'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
  'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
  'OYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYO',
  'OOYYYYYYYYYYYYYYYYYYYYYYYYYYYYOO',
];

const COLORS = {
  W: '#fff3df',
  P: '#fff3df',
  C: '#38e6dd',
  K: '#ff4fc4',
  F: '#b8240c',
  O: '#ff6a1a',
  Y: '#ffc23a',
};

// The neon arch is drawn only on the left; the right side is its mirror, so it stays symmetric
const rows = art.map(line => {
  const row = line.padEnd(G, '.').split('');
  for (let x = G / 2; x < G; x++) if ('CK'.includes(row[x])) row[x] = '.';
  for (let x = 0; x < G / 2; x++) if ('CK'.includes(row[x])) row[G - 1 - x] = row[x];
  return row.join('');
});

const rects = [];
for (let y = 0; y < G; y++) {
  const row = rows[y];
  for (let x = 0; x < G; x++) {
    const color = COLORS[row[x]];
    if (color) rects.push(`<rect x="${x * S}" y="${y * S}" width="${S}" height="${S}" fill="${color}"/>`);
  }
}

const neon = rects.filter(r => /#fff3df|#38e6dd|#ff4fc4/.test(r)).join('\n      ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#14090c"/>
      <stop offset="0.6" stop-color="#2a0c0a"/>
      <stop offset="1" stop-color="#6b1a06"/>
    </linearGradient>
    <radialGradient id="heat" cx="0.5" cy="1" r="0.75">
      <stop offset="0" stop-color="#ff6a1a" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ff6a1a" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <clipPath id="shape"><rect width="256" height="256" rx="48"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="256" height="256" fill="url(#bg)"/>
    <rect width="256" height="256" fill="url(#heat)"/>
    <g filter="url(#glow)" opacity="0.9">
      ${neon}
    </g>
    ${rects.join('\n    ')}
  </g>
</svg>
`;

fs.writeFileSync(path.join(__dirname, 'icon.svg'), svg);
console.log('build/icon.svg written');
