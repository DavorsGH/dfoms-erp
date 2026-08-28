/**
 * Staging verification without Anthropic: RAG retrieval via Voyage + match_handbook_chunks,
 * and FM assigned-properties query matching the assistant tool data path.
 *
 *   npx tsx scripts/test-assistant-fm-handbook-retrieval-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const VOYAGE_MODEL = "voyage-3";
const EMBEDDING_DIMENSIONS = 1024;
const FM_EMAIL = "david.avors+fm@gmail.com";

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
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Array<{
    section_title: string;
    content: string;
    similarity: number;
  }>;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const voyageKey = process.env.VOYAGE_API_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !serviceKey || !voyageKey) {
    throw new Error("Staging Supabase + Voyage credentials required");
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
  const aiHit = aiChunks.some(
    (c) =>
      /AI Assistant/i.test(c.section_title) ||
      /does not create/i.test(c.content) ||
      /role-based access/i.test(c.content),
  );
  record(
    "1. RAG retrieve AI Assistant",
    aiHit,
    aiChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  // Voyage free tier ~3 RPM — brief pause between embeds
  await new Promise((r) => setTimeout(r, 22_000));

  const voidChunks = await match(
    admin,
    "staff",
    "How do I void a client invoice after it has been sent?",
    voyageKey,
  );
  const voidHit = voidChunks.some(
    (c) =>
      /Client Invoices/i.test(c.section_title) ||
      /\bVoid\b/i.test(c.content) ||
      /voided/i.test(c.content),
  );
  record(
    "2. RAG retrieve invoice void",
    voidHit,
    voidChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  await new Promise((r) => setTimeout(r, 22_000));

  const quoteChunks = await match(
    admin,
    "staff",
    "How does Convert to Invoice work for an accepted client quotation?",
    voyageKey,
  );
  const quoteHit = quoteChunks.some(
    (c) =>
      /Quotations/i.test(c.section_title) ||
      /Convert to Invoice/i.test(c.content) ||
      /Authorized By/i.test(c.content),
  );
  record(
    "3. RAG retrieve quote conversion",
    quoteHit,
    quoteChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  await new Promise((r) => setTimeout(r, 22_000));

  const fmChunks = await match(
    admin,
    "facility_manager",
    "What properties am I assigned to and what can I do as a Facility Manager?",
    voyageKey,
  );
  const fmHit = fmChunks.some(
    (c) =>
      /Facility Manager/i.test(c.section_title + c.content) ||
      /can't see/i.test(c.content) ||
      /Collections/i.test(c.content) ||
      /assigned/i.test(c.content),
  );
  record(
    "4. RAG retrieve FM handbook",
    fmHit,
    fmChunks.map((c) => c.section_title).join(" | ") || "(none)",
  );

  const { data: fm } = await admin
    .from("facility_managers")
    .select("facility_manager_id, tenant_id, full_name, status")
    .eq("email", FM_EMAIL.toLowerCase())
    .eq("status", "active")
    .maybeSingle();
  if (!fm) {
    throw new Error(`Active FM not found for ${FM_EMAIL}`);
  }

  const { data: assigns, error: assignError } = await admin
    .from("facility_manager_property_assignments")
    .select("property_id")
    .eq("facility_manager_id", fm.facility_manager_id)
    .eq("tenant_id", fm.tenant_id);

  if (assignError) {
    throw new Error(assignError.message);
  }

  const propertyIds = (assigns ?? []).map((a) => a.property_id as string);
  const { data: properties, error: propError } = propertyIds.length
    ? await admin
        .from("properties")
        .select("property_id, name")
        .eq("tenant_id", fm.tenant_id)
        .in("property_id", propertyIds)
        .order("name", { ascending: true })
    : { data: [], error: null };

  if (propError) {
    throw new Error(propError.message);
  }

  const names = (properties ?? []).map((p) => String(p.name ?? "Property"));
  record(
    "5. FM tool data — assigned properties (same query as get_my_assigned_properties)",
    names.length > 0,
    names.join(", ") || "(none)",
  );

  console.log("\n--- Summary ---");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}: ${c.name}`);
  }
  if (checks.some((c) => !c.pass)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
