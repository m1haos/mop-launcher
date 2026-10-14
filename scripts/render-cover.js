// Draws pack/cover.svg into pack/cover.png (1280x720) with a little film grain.
// The build (pack:build) takes the cover from pack/cover.png.
//
// Usage (in the launcher folder):  npm.cmd run cover

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const W = 1280;
const H = 720;
const PACK_DIR = path.resolve(__dirname, '..', '..', 'pack');
const svg = fs.readFileSync(path.join(PACK_DIR, 'cover.svg'), 'utf8');
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const draw = `new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = ${W};
    canvas.height = ${H};
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, ${W}, ${H});
    // Grain: flat vector colours look like a placeholder, noise makes it read as a frame
    const frame = ctx.getImageData(0, 0, ${W}, ${H});
    const px = frame.data;
    let seed = 1031;
    for (let i = 0; i < px.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed / 4294967296) - 0.5) * 18;
      px[i] += n;
      px[i + 1] += n;
      px[i + 2] += n;
    }
    ctx.putImageData(frame, 0, 0);
    resolve(canvas.toDataURL('image/png'));
  };
  img.onerror = () => reject(new Error('cover.svg did not load'));
  img.src = ${JSON.stringify(svgUrl)};
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const png = await win.webContents.executeJavaScript(draw);
  const out = path.join(PACK_DIR, 'cover.png');
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`Saved ${out}`);
  app.quit();
}).catch(err => {
  console.error(err);
  app.exit(1);
});
