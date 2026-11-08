import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const dir = "public/guatemala/icons";
await mkdir(dir, { recursive: true });

function mark(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="#0f6e56"/>
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <path fill="#f7f4ea" d="M96 268 L256 112 L416 268 V292 H96 Z"/>
      <rect x="168" y="292" width="176" height="128" rx="10" fill="#f7f4ea"/>
      <rect x="228" y="344" width="56" height="76" rx="6" fill="#0f6e56"/>
    </g>
  </svg>`;
}

const files = [
  [192, 0.82, "icon-192.png"],
  [512, 0.82, "icon-512.png"],
  [512, 0.58, "icon-512-maskable.png"],
  [180, 0.82, "apple-touch-icon.png"],
];

for (const [size, scale, name] of files) {
  await sharp(Buffer.from(mark(scale))).resize(size, size).png().toFile(`${dir}/${name}`);
  console.log(name);
}
