/**
 * Staging smoke test: handbook chunk retrieval + screenshot appendix wiring.
 * Standalone (no server-only imports).
 *
 * Usage:
 *   npx tsx scripts/_test-handbook-screenshot-retrieval-staging.ts
 *   npx tsx scripts/_test-handbook-screenshot-retrieval-staging.ts --query "how do quotations work"
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const BUCKET = "handbook-screenshots";
const DEFAULT_QUERY = "how do I record a payment on a product sale";
const VOYAGE_MODEL = "voyage-3";
const EMBEDDING_DIMENSIONS = 1024;

type HandbookChunkMatch = {
  id: string;
  section_title: string;
  content: string;
  similarity: number;
};

type HandbookScreenshotRow = {
  id: string;
  section_key: string;
  file_path: string;
  caption: string | null;
  display_order: number;
};

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

function extractHandbookSectionKey(sectionTitle: string): string | null {
  const subsection = sectionTitle.match(/\b(\d+\.\d+)\b/);
  if (subsection) {
    return subsection[1] ?? null;
  }
  const sectionHeader = sectionTitle.match(/Section\s+(\d+)\s*[—-]/i);
  if (sectionHeader) {
    return `${sectionHeader[1]}.1`;
  }
  return null;
}

function collectHandbookSectionKeys(chunks: HandbookChunkMatch[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const key = extractHandbookSectionKey(chunk.section_title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
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
    throw new Error(`Voyage query embedding failed (${response.status})`);
  }
  const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = payload.data?.[0]?.embedding ?? [];
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected embedding dimension ${embedding.length}`);
  }
  return embedding;
}

async function retrieveHandbookChunks(
  admin: SupabaseClient,
  query: string,
  voyageApiKey: string,
): Promise<HandbookChunkMatch[]> {
  const embedding = await embedQuery(query, voyageApiKey);
  const { data, error } = await admin.rpc("match_handbook_chunks", {
    query_embedding: embedding,
    match_persona: "staff",
    match_count: 5,
  });
  if (error) throw error;
  return (data ?? []) as HandbookChunkMatch[];
}

async function fetchScreenshots(
  admin: SupabaseClient,
  sectionKeys: string[],
): Promise<HandbookScreenshotRow[]> {
  if (sectionKeys.length === 0) return [];
  const { data, error } = await admin
    .from("handbook_screenshots")
    .select("id, section_key, file_path, caption, display_order")
    .in("section_key", sectionKeys)
    .order("section_key", { ascending: true })
    .order("display_order", { ascending: true });
  if (error) throw error;
  const order = new Map(sectionKeys.map((key, index) => [key, index]));
  return ((data ?? []) as HandbookScreenshotRow[]).sort((a, b) => {
    const left = order.get(a.section_key) ?? Number.MAX_SAFE_INTEGER;
    const right = order.get(b.section_key) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.display_order - b.display_order;
  });
}

function buildScreenshotMarkdown(signedUrl: string, caption?: string | null): string {
  const alt = (caption?.trim() || "Handbook screenshot").replace(/[\[\]]/g, "");
  const lines = [`![${alt}](${signedUrl})`];
  if (caption?.trim()) lines.push("", `*${caption.trim()}*`);
  return lines.join("\n");
}

async function appendScreenshots(
  admin: SupabaseClient,
  chunks: HandbookChunkMatch[],
  textReply: string,
): Promise<string> {
  const sectionKeys = collectHandbookSectionKeys(chunks);
  if (sectionKeys.length === 0) return textReply;

  const rows = await fetchScreenshots(admin, sectionKeys);
  if (rows.length === 0) return textReply;

  const blocks: string[] = [];
  for (const row of rows) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(row.file_path, 3600);
    if (error || !data?.signedUrl) {
      console.error("signed URL failed:", row.file_path, error?.message);
      continue;
    }
    blocks.push(buildScreenshotMarkdown(data.signedUrl, row.caption));
  }

  if (blocks.length === 0) return textReply;
  return `${textReply.trim()}\n\n${blocks.join("\n\n")}`.trim();
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const voyageApiKey = process.env.VOYAGE_API_KEY ?? "";
  if (!url.includes(STAGING_REF) || !serviceKey || !voyageApiKey) {
    throw new Error("Missing staging Supabase or VOYAGE_API_KEY in .env.staging.local");
  }

  const query =
    process.argv.includes("--query") &&
    process.argv[process.argv.indexOf("--query") + 1]
      ? process.argv[process.argv.indexOf("--query") + 1]!
      : DEFAULT_QUERY;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const chunks = await retrieveHandbookChunks(admin, query, voyageApiKey);

  console.log("\n=== Handbook screenshot retrieval test (staging) ===\n");
  console.log("Query:", query);
  console.log("\nMatched chunks:");
  for (const chunk of chunks) {
    console.log(
      `  - ${chunk.section_title} (sim=${chunk.similarity.toFixed(3)}, key=${extractHandbookSectionKey(chunk.section_title) ?? "none"})`,
    );
  }

  const keys = collectHandbookSectionKeys(chunks);
  console.log("\nSection keys:", keys.join(", ") || "(none)");

  const mockReply =
    "Here is a concise explanation based on the handbook excerpt for your question.";
  const reply = await appendScreenshots(admin, chunks, mockReply);

  console.log("\n--- Final reply markdown ---\n");
  console.log(reply);
  const hasImage = reply.includes("![") && reply.includes("](http");
  console.log("\nIncludes screenshot markdown:", hasImage);
  if (!hasImage && keys.some((k) => ["7.2", "7.7", "5.1", "6.2"].includes(k))) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
