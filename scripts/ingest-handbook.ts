/**
 * One-time handbook RAG ingestion for the DAVORS-ERP assistant.
 *
 * Reads content/handbook/*.md, chunks by ## / ### headers, embeds with Voyage AI
 * (voyage-3, 1024 dims), and upserts into public.handbook_chunks.
 *
 * Usage (staging — default):
 *   npx tsx scripts/ingest-handbook.ts
 *
 * Parse/chunk only (no API calls or DB writes):
 *   npx tsx scripts/ingest-handbook.ts --dry-run
 *
 * Production (requires explicit override):
 *   ALLOW_PRODUCTION_INGEST=true npx tsx scripts/ingest-handbook.ts --env=production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const VOYAGE_MODEL = "voyage-3";
const EMBEDDING_DIMENSIONS = 1024;
const MAX_WORDS_PER_CHUNK = 800;
/** Small batches for Voyage reduced tier (3 RPM, 10K tokens/min). */
const EMBEDDING_BATCH_SIZE = 4;
/** ~3 requests/minute → one request every ~20s. */
const EMBEDDING_BATCH_DELAY_MS = 20_000;
const VOYAGE_429_MAX_RETRIES = 2;
const VOYAGE_429_BACKOFF_MS = [60_000, 90_000] as const;

const HANDBOOK_FILES = [
  { file: "staff-handbook.md", persona: "staff" as const },
  { file: "landlord-handbook.md", persona: "landlord" as const },
  { file: "tenant-handbook.md", persona: "tenant" as const },
];

type Persona = (typeof HANDBOOK_FILES)[number]["persona"];

type ChunkDraft = {
  persona: Persona;
  section_title: string;
  content: string;
};

type MarkdownBlock = {
  level: number;
  title: string;
  lines: string[];
};

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

function resolveEnvFile(): string {
  const envArg = process.argv.find((arg) => arg.startsWith("--env="));
  const envName = envArg?.split("=")[1] ?? "staging";
  if (envName === "production") {
    return ".env.local";
  }
  return ".env.staging.local";
}

function assertAllowedTarget(supabaseUrl: string) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const allowProduction = process.env.ALLOW_PRODUCTION_INGEST === "true";
  const envArg = process.argv.find((arg) => arg.startsWith("--env="));
  const envName = envArg?.split("=")[1] ?? "staging";

  if (envName === "production") {
    if (!allowProduction) {
      throw new Error(
        "Refusing production ingest. Set ALLOW_PRODUCTION_INGEST=true and pass --env=production to proceed.",
      );
    }
    console.warn(`WARNING: ingesting handbook chunks into production (${ref}).`);
    return;
  }

  if (ref !== STAGING_PROJECT_REF) {
    throw new Error(
      `Refusing ingest: expected staging project ${STAGING_PROJECT_REF}, got ${ref}. Use --env=production with ALLOW_PRODUCTION_INGEST=true for production.`,
    );
  }
}

function cleanHeader(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/\\/g, "").trim();
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let current: MarkdownBlock | null = null;

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      if (current) {
        blocks.push(current);
      }
      current = {
        level: match[1].length,
        title: cleanHeader(match[2]),
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function splitLongBody(
  sectionTitle: string,
  body: string,
): { section_title: string; content: string }[] {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return [];
  }

  const baseContent = (title: string, text: string) =>
    `# ${title}\n\n${text}`.trim();

  if (wordCount(trimmedBody) <= MAX_WORDS_PER_CHUNK) {
    return [
      {
        section_title: sectionTitle,
        content: baseContent(sectionTitle, trimmedBody),
      },
    ];
  }

  const paragraphs = trimmedBody.split(/\n\s*\n/).filter((part) => part.trim());
  const results: { section_title: string; content: string }[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;
  let part = 1;

  function flush() {
    if (buffer.length === 0) {
      return;
    }
    const title =
      part === 1 && results.length === 0
        ? sectionTitle
        : `${sectionTitle} (part ${part})`;
    results.push({
      section_title: title,
      content: baseContent(title, buffer.join("\n\n")),
    });
    part += 1;
    buffer = [];
    bufferWords = 0;
  }

  for (const paragraph of paragraphs) {
    const paragraphWords = wordCount(paragraph);
    if (bufferWords + paragraphWords > MAX_WORDS_PER_CHUNK && buffer.length > 0) {
      flush();
    }
    buffer.push(paragraph);
    bufferWords += paragraphWords;
  }

  flush();
  return results;
}

function chunkMarkdown(markdown: string, persona: Persona): ChunkDraft[] {
  const blocks = parseMarkdownBlocks(markdown);
  const chunks: ChunkDraft[] = [];
  let currentH1 = "";

  for (const block of blocks) {
    if (block.title.toLowerCase().includes("table of contents")) {
      continue;
    }

    if (block.level === 1) {
      currentH1 = block.title;
      const body = block.lines.join("\n").trim();
      if (body) {
        for (const piece of splitLongBody(block.title, body)) {
          chunks.push({ persona, ...piece });
        }
      }
      continue;
    }

    if (block.level === 2 || block.level === 3) {
      const sectionTitle = currentH1
        ? `${currentH1} — ${block.title}`
        : block.title;
      const body = block.lines.join("\n").trim();
      if (!body) {
        continue;
      }
      for (const piece of splitLongBody(sectionTitle, body)) {
        chunks.push({ persona, ...piece });
      }
    }
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  let lastRateLimitDetail = "";

  for (let attempt = 0; attempt <= VOYAGE_429_MAX_RETRIES; attempt++) {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: VOYAGE_MODEL,
        input_type: "document",
      }),
    });

    if (response.status === 429) {
      lastRateLimitDetail = await response.text();
      if (attempt < VOYAGE_429_MAX_RETRIES) {
        const waitMs = VOYAGE_429_BACKOFF_MS[attempt] ?? 90_000;
        console.warn(
          `  Voyage rate limited (429). Waiting ${waitMs / 1000}s before retry ${attempt + 1}/${VOYAGE_429_MAX_RETRIES} …`,
        );
        await sleep(waitMs);
        continue;
      }
      throw new Error(
        `Voyage embeddings rate limited after ${VOYAGE_429_MAX_RETRIES} retries: ${lastRateLimitDetail}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Voyage embeddings failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    const embeddings = payload.data?.map((row) => row.embedding ?? []) ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error("Voyage embeddings response length mismatch.");
    }

    for (const embedding of embeddings) {
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Unexpected embedding dimension ${embedding.length}; expected ${EMBEDDING_DIMENSIONS}.`,
        );
      }
    }

    return embeddings;
  }

  throw new Error(
    `Voyage embeddings failed after retries: ${lastRateLimitDetail || "unknown error"}`,
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const envFile = resolveEnvFile();
  try {
    loadEnvForce(resolve(process.cwd(), envFile));
  } catch {
    throw new Error(`Could not load ${envFile}.`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const voyageApiKey = process.env.VOYAGE_API_KEY ?? "";

  if (!dryRun) {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        `Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envFile}.`,
      );
    }
    if (!voyageApiKey) {
      throw new Error(
        `Missing VOYAGE_API_KEY in ${envFile}. Sign up at https://www.voyageai.com/ and add your API key.`,
      );
    }
    assertAllowedTarget(supabaseUrl);
  }

  const supabase =
    dryRun
      ? null
      : createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

  const summary: Record<Persona, number> = {
    staff: 0,
    landlord: 0,
    tenant: 0,
  };

  let isFirstEmbeddingBatch = true;

  for (const { file, persona } of HANDBOOK_FILES) {
    const filePath = resolve(process.cwd(), "content/handbook", file);
    console.log(`\n=== ${file} (${persona}) ===`);
    const markdown = readFileSync(filePath, "utf8");
    const drafts = chunkMarkdown(markdown, persona);
    console.log(`Parsed ${drafts.length} chunk(s).`);

    if (dryRun) {
      for (const chunk of drafts) {
        console.log(`  - ${chunk.section_title} (${wordCount(chunk.content)} words)`);
      }
      summary[persona] = drafts.length;
      continue;
    }

    console.log(`Clearing existing handbook_chunks for persona=${persona} …`);
    const { error: deleteError } = await supabase!
      .from("handbook_chunks")
      .delete()
      .eq("persona", persona);
    if (deleteError) {
      throw new Error(`Delete failed for ${persona}: ${deleteError.message}`);
    }

    for (let index = 0; index < drafts.length; index += EMBEDDING_BATCH_SIZE) {
      if (!isFirstEmbeddingBatch) {
        console.log(
          `  Waiting ${EMBEDDING_BATCH_DELAY_MS / 1000}s (Voyage 3 RPM limit) …`,
        );
        await sleep(EMBEDDING_BATCH_DELAY_MS);
      }
      isFirstEmbeddingBatch = false;

      const batch = drafts.slice(index, index + EMBEDDING_BATCH_SIZE);
      const batchNumber = Math.floor(index / EMBEDDING_BATCH_SIZE) + 1;
      console.log(
        `Embedding batch ${batchNumber} (${batch.length} chunk(s)) …`,
      );

      for (const chunk of batch) {
        console.log(`  - ${chunk.section_title}`);
      }

      const embeddings = await embedTexts(
        batch.map((chunk) => chunk.content),
        voyageApiKey,
      );

      const rows = batch.map((chunk, rowIndex) => ({
        persona: chunk.persona,
        section_title: chunk.section_title,
        content: chunk.content,
        embedding: embeddings[rowIndex],
      }));

      const { error: insertError } = await supabase!
        .from("handbook_chunks")
        .insert(rows);
      if (insertError) {
        throw new Error(`Insert failed for ${persona}: ${insertError.message}`);
      }
    }

    summary[persona] = drafts.length;
    console.log(`Inserted ${drafts.length} chunk(s) for ${persona}.`);
  }

  console.log("\n=== Ingestion complete ===");
  for (const [persona, count] of Object.entries(summary)) {
    console.log(`  ${persona}: ${count} chunk(s)`);
  }
  console.log(`  total: ${Object.values(summary).reduce((a, b) => a + b, 0)} chunk(s)`);
  if (dryRun) {
    console.log("\nDry run only — no embeddings generated and no database writes.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
