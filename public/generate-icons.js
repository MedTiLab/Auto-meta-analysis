import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(__filename);
const sourceSvgPath = path.join(rootDir, 'icons', 'file.svg');

async function main() {
  const sourceSvg = fs.readFileSync(sourceSvgPath);

  for (const size of sizes) {
    const outputPath = path.join(rootDir, 'icons', `icon-${size}x${size}.png`);
    await sharp(sourceSvg)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Created ${path.basename(outputPath)}`);
  }

  await sharp(sourceSvg)
    .resize(64, 64)
    .png()
    .toFile(path.join(rootDir, 'favicon.png'));
  console.log('Created favicon.png');

  await sharp(sourceSvg)
    .resize(512, 512)
    .png()
    .toFile(path.join(rootDir, 'app-logo.png'));
  console.log('Created app-logo.png');
}

main().catch((error) => {
  console.error('Failed to generate brand icons:', error);
  process.exit(1);
});
