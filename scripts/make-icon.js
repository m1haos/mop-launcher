// Draws build/icon.svg (the studio icon) into build/icon.png (512x512), build/icon.ico (16-256 px)
// and src/renderer/assets/brand.png (the header mark), and build/logo.svg (MINI GAMES STUDIO,
// made by the logo tools of the studio) into src/renderer/assets/studio-logo.png.
// Electron does the drawing because Windows has no SVG converter out of the box.
// The .ico is made here too: the converter of electron-builder fails on some PCs
// with "WebAssembly.Memory(): could not allocate memory".
//
// Usage (in the launcher folder):  npm.cmd run icon

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// The library shows the logo 230 px wide; twice that for sharp HiDPI screens
const LOGO_WIDTH = 460 * 2;

const svgUrl = name => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', name), 'utf8');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

const draw = (url, width, height = width) => `new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = ${width};
    canvas.height = ${height} || Math.round(${width} * img.naturalHeight / img.naturalWidth);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL('image/png'));
  };
  img.onerror = () => reject(new Error('SVG did not load'));
  img.src = ${JSON.stringify(url)};
})`;

// An .ico file is a small header, one 16-byte entry per size, then the images (PNG works since Vista)
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const icon = svgUrl('icon.svg');
  const toPng = async script => Buffer.from((await win.webContents.executeJavaScript(script)).split(',')[1], 'base64');
  const render = size => toPng(draw(icon, size));

  const dir = path.join(__dirname, '..', 'build');
  fs.writeFileSync(path.join(dir, 'icon.png'), await render(SIZE));
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(size) });
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico(images));
  // The logo in the launcher header: 32 px on screen, twice that for sharp HiDPI screens
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'assets', 'brand.png'), await render(64));
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'assets', 'studio-logo.png'), await toPng(draw(svgUrl('logo.svg'), LOGO_WIDTH, 0)));
  console.log(`Saved icon.png and icon.ico in ${dir}, brand.png and studio-logo.png in src/renderer/assets`);
  app.quit();
}).catch(err => {
  console.error(err);
  app.exit(1);
});
