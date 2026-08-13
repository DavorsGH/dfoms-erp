/**
 * One-off: ensure Davors staging tenant has a distinct signature image for Phase 1 PDF tests.
 * Writes to tenants.signature_url only (never logo_url). Image is a handwritten-style
 * scribble — not the company logo file.
 */
// @ts-nocheck
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const STORAGE_PATH = `${DAVORS}/signature.png`;
const FIXTURE_PATH = resolve("scripts/fixtures/phase1-test-signature.png");

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function buildDistinctSignaturePng() {
  const svg = `
    <svg width="240" height="72" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <path
        d="M18 48 C 42 18, 66 58, 90 34 S 138 22, 162 40 S 198 54, 222 28"
        fill="none"
        stroke="#0f2744"
        stroke-width="3"
        stroke-linecap="round"
      />
      <path
        d="M28 56 C 52 44, 78 52, 104 46 S 156 38, 188 50"
        fill="none"
        stroke="#0f2744"
        stroke-width="2"
        stroke-linecap="round"
        opacity="0.85"
      />
      <text x="18" y="68" font-family="Georgia, serif" font-size="10" fill="#64748b">Test Signature</text>
    </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  loadEnvForce(resolve(".env.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const signatureBytes = await buildDistinctSignaturePng();
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, signatureBytes);

  const logoBytes = readFileSync(resolve("public/logo.jpg"));
  const sameAsLogo = signatureBytes.equals(logoBytes);
  console.log("Distinct signature PNG bytes:", signatureBytes.length);
  console.log("Signature bytes identical to public/logo.jpg:", sameAsLogo);
  if (sameAsLogo) {
    throw new Error("Generated signature must not match the company logo file.");
  }

  const { error: uploadError } = await admin.storage
    .from("tenant-logos")
    .upload(STORAGE_PATH, signatureBytes, {
      upsert: true,
      contentType: "image/png",
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data: before } = await admin
    .from("tenants")
    .select("logo_url, signature_url")
    .eq("id", DAVORS)
    .maybeSingle();

  const { error: updateError } = await admin
    .from("tenants")
    .update({
      signature_url: STORAGE_PATH,
      updated_at: new Date().toISOString(),
    })
    .eq("id", DAVORS);

  if (updateError) {
    throw new Error(`Tenant update failed: ${updateError.message}`);
  }

  const { data: after } = await admin
    .from("tenants")
    .select("logo_url, signature_url")
    .eq("id", DAVORS)
    .maybeSingle();

  console.log("Before seed:", before);
  console.log("After seed:", after);
  console.log(`Seeded distinct test signature at ${STORAGE_PATH} (signature_url only)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
