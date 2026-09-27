/**
 * Staging handbook RAG — Director's Loan ledger + PAYE (post-ingest).
 *
 *   npx tsx scripts/test-assistant-directors-loan-handbook-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const VOYAGE_MODEL = "voyage-3";

const QUERIES = [
  {
    name: "personal expense (Director's Loan)",
    query: "How do I record money the company paid for my personal expense?",
    expectInTop: ["personal expense", "Director's Loan", "Company paid"],
  },
  {
    name: "correct wrong Director's Loan entry",
    query: "How do I correct a wrong Director's Loan entry?",
    expectInTop: ["Reverse", "Edit", "audit"],
  },
  {
    name: "PAYE rates",
    query: "What are the current PAYE rates?",
    expectInTop: ["PAYE", "588", "Act 1178"],
    forbidSubstring: ["statutory_paye_tax_bands"],
  },
] as const;

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
    throw new Error(`Voyage ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  return payload.data?.[0]?.embedding ?? [];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const voyageKey = process.env.VOYAGE_API_KEY ?? "";
  if (!url.includes(STAGING_REF) || !key || !voyageKey) {
    throw new Error("Staging env + Voyage required (.env.staging.local)");
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let failed = 0;
  for (const item of QUERIES) {
    console.log(`\n=== ${item.name} ===`);
    console.log(`Q: ${item.query}`);
    const embedding = await embedQuery(item.query, voyageKey);
    const { data, error } = await admin.rpc("match_handbook_chunks", {
      query_embedding: embedding,
      match_persona: "staff",
      match_count: 5,
    });
    if (error) throw new Error(error.message);
    const chunks = (data ?? []) as Array<{
      section_title: string;
      content: string;
      similarity: number;
    }>;
    for (const [i, c] of chunks.entries()) {
      console.log(
        `  #${i + 1} sim=${c.similarity.toFixed(3)} | ${c.section_title}`,
      );
    }
    const topThreeBlob = chunks
      .slice(0, 3)
      .map((c) => `${c.section_title}\n${c.content}`)
      .join("\n")
      .toLowerCase();
    for (const needle of item.expectInTop) {
      if (!topThreeBlob.includes(needle.toLowerCase())) {
        console.log(`  FAIL missing in top 3: "${needle}"`);
        failed += 1;
      }
    }
    if ("forbidSubstring" in item && item.forbidSubstring) {
      const allText = chunks.map((c) => c.content).join("\n").toLowerCase();
      for (const bad of item.forbidSubstring) {
        if (allText.includes(bad.toLowerCase())) {
          console.log(`  FAIL forbidden in top-5: "${bad}"`);
          failed += 1;
        }
      }
    }
  }

  if (failed > 0) {
    console.log(`\n${failed} check(s) failed — re-run ingest-handbook on staging.`);
    process.exit(1);
  }
  console.log("\nPASS — RAG top hits look correct for all three queries.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
