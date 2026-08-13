/**
 * Verify PDF footer box + authorized-by title after fixes.
 * Usage: npx tsx scripts/_verify-pdf-fixes.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath: string) {
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

function extractPdfStrings(pdfPath: string): string[] {
  const raw = readFileSync(pdfPath, "latin1");
  const chunks: string[] = [];
  for (const match of raw.matchAll(/\(([^\\)]{2,})\)/g)) {
    chunks.push(match[1].replace(/\\n/g, " ").replace(/\\r/g, ""));
  }
  return chunks;
}

function countPages(pdfPath: string): number {
  const raw = readFileSync(pdfPath, "latin1");
  return (raw.match(/\/Type\s*\/Page\b/g) ?? []).length;
}

async function main() {
  loadEnvForce(resolve(".env.local.backup"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: tenant } = await admin
    .from("tenants")
    .select("signature_author_title")
    .eq("id", DAVORS)
    .single();

  const workspaceTitle = tenant?.signature_author_title?.trim() ?? "(none)";
  console.log("Workspace Settings title:", workspaceTitle);

  const pdfs = [
    "scripts/_phase2-prod-quotation-DF-CQUO-0002.pdf",
    "scripts/_phase2-prod-invoice-DF-INV-0001.pdf",
    "scripts/_phase2-prod-receipt-DF-RCPT-0002.pdf",
  ];

  for (const rel of pdfs) {
    const pdfPath = resolve(rel);
    const strings = extractPdfStrings(pdfPath);
    const joined = strings.join(" ");
    const validityCount = (joined.match(/valid until/gi) ?? []).length;
    const paymentFooterCount = (joined.match(/Payment is due within 30 days/gi) ?? []).length;
    const ceoShort = strings.filter((s) => s.trim() === "CEO," || s.trim() === "CEO").length;
    const ceoLong = strings.filter((s) =>
      /Chief Executive Officer/i.test(s),
    ).length;
    const pages = countPages(pdfPath);

    console.log(`\n${rel} (${pages} pages)`);
    console.log("  validity notice count:", validityCount);
    console.log("  payment footer count:", paymentFooterCount);
    console.log("  'CEO' title hits:", ceoShort);
    console.log("  'Chief Executive Officer' hits:", ceoLong);
    console.log(
      "  title matches workspace:",
      workspaceTitle &&
        joined.includes(workspaceTitle) &&
        !joined.includes("CEO,"),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
