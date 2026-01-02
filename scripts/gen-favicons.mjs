import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'renderer');

function crc32(buf) {
  // CRC32 (IEEE)
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function pngFromRgba({ width, height, rgba }) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowLen = width * 4;
  const raw = Buffer.alloc(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowLen)] = 0; // no filter
    rgba.copy(raw, y * (1 + rowLen) + 1, y * rowLen, y * rowLen + rowLen);
  }

  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawNIcon(size) {
  const width = size;
  const height = size;
  const rgba = Buffer.alloc(width * height * 4);

  const bg = { r: 0x89, g: 0xb4, b: 0xfa, a: 0xff }; // accent
  const fg = { r: 0xff, g: 0xff, b: 0xff, a: 0xff }; // white

  const pad = Math.max(3, Math.floor(size * 0.22));
  const sw = Math.max(2, Math.floor(size * 0.09));

  // Helper: set pixel
  function setPixel(x, y, c) {
    const i = (y * width + x) * 4;
    rgba[i] = c.r;
    rgba[i + 1] = c.g;
    rgba[i + 2] = c.b;
    rgba[i + 3] = c.a;
  }

  // Background
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(x, y, bg);
    }
  }

  // Draw N: left stroke, right stroke, diagonal
  const xL0 = pad;
  const xL1 = pad + sw;
  const xR1 = width - pad;
  const xR0 = xR1 - sw;
  const yT = pad;
  const yB = height - pad;

  for (let y = yT; y < yB; y++) {
    for (let x = xL0; x < xL1; x++) setPixel(x, y, fg);
    for (let x = xR0; x < xR1; x++) setPixel(x, y, fg);
  }

  // Diagonal from (xL1, yT) to (xR0, yB)
  const dx = (xR0 - xL1);
  const dy = (yB - yT);
  for (let t = 0; t <= dx; t++) {
    const x = xL1 + t;
    const y = yT + Math.round((t * dy) / dx);
    for (let oy = -Math.floor(sw / 2); oy <= Math.floor(sw / 2); oy++) {
      for (let ox = -Math.floor(sw / 2); ox <= Math.floor(sw / 2); ox++) {
        const xx = x + ox;
        const yy = y + oy;
        if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
          setPixel(xx, yy, fg);
        }
      }
    }
  }

  return pngFromRgba({ width, height, rgba });
}

function writePng(filename, size) {
  const buf = drawNIcon(size);
  fs.writeFileSync(path.join(OUT_DIR, filename), buf);
  console.log(`[favicons] wrote ${filename} (${size}x${size})`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
writePng('favicon-16.png', 16);
writePng('favicon-32.png', 32);
writePng('apple-touch-icon.png', 180);
writePng('icon-192.png', 192);
writePng('icon-512.png', 512);
