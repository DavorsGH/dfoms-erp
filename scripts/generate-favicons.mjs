import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import toIco from "to-ico";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = path.join(root, "public", "logo.jpg");
const appDir = path.join(root, "app");
const publicDir = path.join(root, "public");

const WHITE_BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };

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

  fs.writeFileSync(path.join(appDir, "favicon.ico"), await toIco(icoBuffers));

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
