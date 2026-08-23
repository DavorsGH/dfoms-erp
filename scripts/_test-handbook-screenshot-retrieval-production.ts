/**
 * Production retrieval smoke test (same logic as staging script, production env).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const BUCKET = "handbook-screenshots";
const QUERY = process.argv.includes("--query")
  ? process.argv[process.argv.indexOf("--query") + 1]!
  : "how do I record a payment on a product sale";
const VOYAGE_MODEL = "voyage-3";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function extractKey(title: string): string | null {
  const sub = title.match(/\b(\d+\.\d+)\b/);
  if (sub) return sub[1] ?? null;
  const sec = title.match(/Section\s+(\d+)\s*[—-]/i);
  return sec ? `${sec[1]}.1` : null;
}

async function main() {
  loadEnvForce(resolve(".env.local.backup"));
  const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  let voyageApiKey = process.env.VOYAGE_API_KEY ?? "";
  if (!voyageApiKey) {
    try {
      const staging = readFileSync(resolve(".env.staging.local"), "utf8");
      for (const line of staging.split(/\r?\n/)) {
        if (line.startsWith("VOYAGE_API_KEY=")) {
          voyageApiKey = line.slice("VOYAGE_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = prodUrl;
  const url = prodUrl;
  if (!url.includes(PRODUCTION_REF) || !serviceKey || !voyageApiKey) {
    throw new Error("Missing production Supabase or VOYAGE_API_KEY");
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const embedRes = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${voyageApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: [QUERY], model: VOYAGE_MODEL, input_type: "query" }),
  });
  if (!embedRes.ok) throw new Error(`Voyage failed: ${embedRes.status}`);
  const embedding = ((await embedRes.json()) as { data?: Array<{ embedding?: number[] }> })
    .data?.[0]?.embedding;
  if (!embedding?.length) throw new Error("No embedding");

  const { data: chunks, error } = await admin.rpc("match_handbook_chunks", {
    query_embedding: embedding,
    match_persona: "staff",
    match_count: 5,
  });
  if (error) throw error;

  console.log("\n=== Production retrieval test ===\nQuery:", QUERY);
  const keys: string[] = [];
  for (const chunk of chunks ?? []) {
    const key = extractKey(chunk.section_title);
    console.log(`  - ${chunk.section_title} (sim=${Number(chunk.similarity).toFixed(3)}, key=${key})`);
    if (key && !keys.includes(key)) keys.push(key);
  }

  const { data: shots } = await admin
    .from("handbook_screenshots")
    .select("section_key, file_path")
    .in("section_key", keys);
  console.log("\nSection keys:", keys.join(", "));
  console.log("Matching screenshots:", shots);

  if (keys.includes("7.2") && shots?.some((s) => s.section_key === "7.2")) {
    const row = shots!.find((s) => s.section_key === "7.2")!;
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(row.file_path, 3600);
    console.log("\n7.2 signed URL ok:", Boolean(signed?.signedUrl));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
