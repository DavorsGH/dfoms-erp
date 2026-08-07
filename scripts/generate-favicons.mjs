import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = path.join(root, "public", "logo.jpg");
const appDir = path.join(root, "app");
const publicDir = path.join(root, "public");

const WHITE_BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };

/** Pack PNG buffers into a single .ico (PNG-in-ICO, Vista+). */
function pngBuffersToIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let dataOffset = headerSize;

  const entries = pngBuffers.map((buffer) => {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const entry = {
      width: width >= 256 ? 0 : width,
      height: height >= 256 ? 0 : height,
      size: buffer.length,
      offset: dataOffset,
    };
    dataOffset += buffer.length;
    return entry;
  });

  const ico = Buffer.alloc(dataOffset);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(count, 4);

  let entryOffset = 6;
  for (const entry of entries) {
    ico.writeUInt8(entry.width, entryOffset);
    ico.writeUInt8(entry.height, entryOffset + 1);
    ico.writeUInt8(0, entryOffset + 2);
    ico.writeUInt8(0, entryOffset + 3);
    ico.writeUInt16LE(1, entryOffset + 4);
    ico.writeUInt16LE(32, entryOffset + 6);
    ico.writeUInt32LE(entry.size, entryOffset + 8);
    ico.writeUInt32LE(entry.offset, entryOffset + 12);
    entryOffset += 16;
  }

  let writeOffset = headerSize;
  for (const buffer of pngBuffers) {
    buffer.copy(ico, writeOffset);
    writeOffset += buffer.length;
  }

  return ico;
}

async function buildFaviconPipeline(cropRatio) {
  const metadata = await sharp(logoPath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const baseSize = Math.min(width, height);
  const cropSize = Math.round(baseSize * cropRatio);
  const left = Math.max(0, Math.round((width - cropSize) / 2));
  const top = Math.max(0, Math.round((height - cropSize) / 2));

  return sharp(logoPath).extract({
    left,
    top,
    width: Math.min(cropSize, width - left),
    height: Math.min(cropSize, height - top),
  });
}

async function renderIcon(pipeline, size, { sharpen = false } = {}) {
  let image = pipeline
    .clone()
    .resize(size, size, {
      fit: "contain",
      background: WHITE_BACKGROUND,
    })
    .ensureAlpha()
    .png();

  if (sharpen) {
    image = image.sharpen();
  }

  return image.toBuffer();
}

async function generateFavicons() {
  const smallSource = await buildFaviconPipeline(0.58);
  const standardSource = await buildFaviconPipeline(0.68);

  const icoBuffers = await Promise.all([
    renderIcon(smallSource, 16, { sharpen: true }),
    renderIcon(smallSource, 32, { sharpen: true }),
    renderIcon(standardSource, 48),
  ]);

  fs.writeFileSync(path.join(appDir, "favicon.ico"), pngBuffersToIco(icoBuffers));

  await renderIcon(smallSource, 32, { sharpen: true }).then((buffer) =>
    fs.writeFileSync(path.join(appDir, "icon.png"), buffer),
  );

  await renderIcon(standardSource, 180).then((buffer) =>
    fs.writeFileSync(path.join(appDir, "apple-icon.png"), buffer),
  );

  await renderIcon(standardSource, 192).then((buffer) =>
    fs.writeFileSync(path.join(publicDir, "icon-192.png"), buffer),
  );

  await renderIcon(standardSource, 512).then((buffer) =>
    fs.writeFileSync(path.join(publicDir, "icon-512.png"), buffer),
  );

  console.log(
    "Generated favicon.ico, app/icon.png, app/apple-icon.png, icon-192.png, icon-512.png",
  );
}

generateFavicons().catch((error) => {
  console.error(error);
  process.exit(1);
});
