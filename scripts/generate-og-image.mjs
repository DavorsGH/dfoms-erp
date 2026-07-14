import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = path.join(root, "public", "logo.jpg");
const outputPath = path.join(root, "public", "og-image.png");

const WIDTH = 1200;
const HEIGHT = 630;
const LOGO_SIZE = 240;
const NAVY = { r: 15, g: 39, b: 68, alpha: 1 };

async function buildLogoPipeline() {
  const metadata = await sharp(logoPath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const baseSize = Math.min(width, height);
  const cropSize = Math.round(baseSize * 0.68);
  const left = Math.max(0, Math.round((width - cropSize) / 2));
  const top = Math.max(0, Math.round((height - cropSize) / 2));

  return sharp(logoPath).extract({
    left,
    top,
    width: Math.min(cropSize, width - left),
    height: Math.min(cropSize, height - top),
  });
}

function buildTextOverlaySvg() {
  const titleY = 400;
  const subtitleY = 448;

  return Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text
    x="600"
    y="${titleY}"
    text-anchor="middle"
    fill="#FFFFFF"
    font-family="Arial, Helvetica, sans-serif"
    font-size="42"
    font-weight="700"
    letter-spacing="2"
  >DAVORS FACILITIES ERP</text>
  <text
    x="600"
    y="${subtitleY}"
    text-anchor="middle"
    fill="#9FB2C9"
    font-family="Arial, Helvetica, sans-serif"
    font-size="24"
    font-weight="400"
  >Davors Facilities Management Services Ltd</text>
</svg>`);
}

async function generateOgImage() {
  if (!fs.existsSync(logoPath)) {
    throw new Error(`Missing logo at ${logoPath}`);
  }

  const logoTop = 108;
  const logoLeft = Math.round((WIDTH - LOGO_SIZE) / 2);

  const pipeline = await buildLogoPipeline();
  const logoBuffer = await pipeline
    .resize(LOGO_SIZE, LOGO_SIZE, {
      fit: "contain",
      background: NAVY,
    })
    .png()
    .toBuffer();

  const textOverlay = buildTextOverlaySvg();

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: NAVY,
    },
  })
    .composite([
      { input: logoBuffer, top: logoTop, left: logoLeft },
      { input: textOverlay, top: 0, left: 0 },
    ])
    .png()
    .toFile(outputPath);

  const { width, height } = await sharp(outputPath).metadata();
  console.log(`Generated ${outputPath} (${width}x${height})`);
}

generateOgImage().catch((error) => {
  console.error(error);
  process.exit(1);
});
