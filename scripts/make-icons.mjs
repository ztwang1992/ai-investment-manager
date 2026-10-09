// Generates placeholder icons: a cream circle on the primary color (colors from tokens.css --color-accent / --color-bg).
// Once the real icons are designed, replace the files of the same names in public/icons/. Usage: node scripts/make-icons.mjs
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const ACCENT = [0xc6, 0x71, 0x39];
const CREAM = [0xf5, 0xea, 0xd8];
const SUPERSAMPLE = 4;

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A square PNG with sides of size, with a circle of radius size × radiusRatio in the middle (antialiased edge). */
function icon(size, radiusRatio) {
  const rowLength = size * 4 + 1;
  const pixels = Buffer.alloc(rowLength * size);
  const center = size / 2;
  const radius = size * radiusRatio;
  for (let y = 0; y < size; y++) {
    pixels[y * rowLength] = 0;
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const dx = x + (sx + 0.5) / SUPERSAMPLE - center;
          const dy = y + (sy + 0.5) / SUPERSAMPLE - center;
          if (dx * dx + dy * dy <= radius * radius) inside++;
        }
      }
      const t = inside / (SUPERSAMPLE * SUPERSAMPLE);
      const offset = y * rowLength + 1 + x * 4;
      for (let k = 0; k < 3; k++) pixels[offset + k] = Math.round(ACCENT[k] * (1 - t) + CREAM[k] * t);
      pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
const icons = [
  ['icon-192.png', 192, 0.3],
  ['icon-512.png', 512, 0.3],
  ['icon-maskable-512.png', 512, 0.24], // maskable: the shape stays within the central 80% safe zone
  ['apple-touch-icon.png', 180, 0.3],
];
for (const [name, size, ratio] of icons) writeFileSync(`public/icons/${name}`, icon(size, ratio));
console.log(`已生成 ${icons.length} 个图标到 public/icons/`);
