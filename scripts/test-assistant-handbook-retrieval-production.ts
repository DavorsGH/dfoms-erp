/**
 * Production RAG retrieval verification (same checks as staging).
 *
 *   npx tsx scripts/test-assistant-handbook-retrieval-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const VOYAGE_MODEL = "voyage-3";
const EMBEDDING_DIMENSIONS = 1024;

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function loadProductionEnv() {
  for (const file of [".env.local.backup", ".env.vercel.production.local"]) {
    try {
      loadEnvForce(resolve(process.cwd(), file));
      return file;
    } catch {
      /* try next */
    }
  }
  throw new Error("Missing production env file");
}

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}: ${detail}`);
}

async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: "query",
    }),
  });
  if (!response.ok) {
    throw new Error(`Voyage failed ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = payload.data?.[0]?.embedding ?? [];
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`bad embedding dim ${embedding.length}`);
  }
  return embedding;
}

async function match(
  admin: ReturnType<typeof createClient>,
  persona: string,
  query: string,
  voyageKey: string,
) {
  const embedding = await embedQuery(query, voyageKey);
  const { data, error } = await admin.rpc("match_handbook_chunks", {
    query_embedding: embedding,
    match_persona: persona,
    match_count: 5,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    section_title: string;
    content: string;
    similarity: number;
  }>;
}

async function main() {
  const envFile = loadProductionEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  let voyageKey = process.env.VOYAGE_API_KEY?.trim() ?? "";

  // Pull Voyage only — do not overwrite production Supabase URL/keys
  if (!voyageKey) {
    try {
      const staging = readFileSync(
        resolve(process.cwd(), ".env.staging.local"),
        "utf8",
      );
      for (const line of staging.split(/\r?\n/)) {
        if (!line.startsWith("VOYAGE_API_KEY=")) continue;
        let v = line.slice("VOYAGE_API_KEY=".length).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        voyageKey = v;
        console.warn("Using VOYAGE_API_KEY from .env.staging.local");
        break;
      }
    } catch {
      /* ignore */
    }
  }

  const ref = url ? new URL(url).hostname.split(".")[0] : "";
  if (ref !== PRODUCTION_REF || !serviceKey || !voyageKey) {
    throw new Error(
      `Production Supabase + Voyage required (env=${envFile}, ref=${ref})`,
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count } = await admin
    .from("handbook_chunks")
    .select("id", { count: "exact", head: true });
  console.log(`handbook_chunks: ${count ?? 0}`);

  const byPersona = await Promise.all(
    ["staff", "landlord", "tenant", "facility_manager"].map(async (persona) => {
      const { count: c } = await admin
        .from("handbook_chunks")
        .select("id", { count: "exact", head: true })
        .eq("persona", persona);
      return `${persona}=${c ?? 0}`;
    }),
  );
  console.log("by persona:", byPersona.join(", "));

  const aiChunks = await match(
    admin,
    "staff",
    "What can the AI Assistant do? Does it create or delete records?",
    voyageKey,
  );
  record(
    "1. RAG retrieve AI Assistant",
    aiChunks.some(
      (c) =>
        /AI Assistant/i.test(c.section_title) ||
        /does not create/i.test(c.content) ||
        /role-based access/i.test(c.content),
    ),
    aiChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  await new Promise((r) => setTimeout(r, 22_000));

  const voidChunks = await match(
    admin,
    "staff",
    "How do I void a client invoice after it has been sent?",
    voyageKey,
  );
  record(
    "2. RAG retrieve invoice void",
    voidChunks.some(
      (c) =>
        /Client Invoices/i.test(c.section_title) ||
        /\bVoid\b/i.test(c.content) ||
        /voided/i.test(c.content),
    ),
    voidChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  await new Promise((r) => setTimeout(r, 22_000));

  const quoteChunks = await match(
    admin,
    "staff",
    "How does Convert to Invoice work for an accepted client quotation?",
    voyageKey,
  );
  record(
    "3. RAG retrieve quote conversion",
    quoteChunks.some(
      (c) =>
        /Quotations/i.test(c.section_title) ||
        /Convert to Invoice/i.test(c.content) ||
        /Authorized By/i.test(c.content),
    ),
    quoteChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  await new Promise((r) => setTimeout(r, 22_000));

  const fmChunks = await match(
    admin,
    "facility_manager",
    "What can I do as a Facility Manager and what can't I see?",
    voyageKey,
  );
  record(
    "4. RAG retrieve FM handbook",
    fmChunks.some(
      (c) =>
        /Facility Manager/i.test(c.section_title + c.content) ||
        /can't see/i.test(c.content) ||
        /Collections/i.test(c.content),
    ),
    fmChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  console.log("\n--- Summary ---");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}: ${c.name}`);
  }
  if (checks.some((c) => !c.pass)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
