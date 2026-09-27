/**
 * Staging: assistant + RAG answers for asset/supplier-contract guidance.
 *
 *   APP_URL=https://... npx tsx scripts/test-assistant-asset-handbook-staging.ts [--label=before]
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
async function retrieveRag(
  admin: ReturnType<typeof createClient>,
  query: string,
  voyageKey: string,
) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${voyageKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [query] }),
  });
  if (!res.ok) return [] as { section_title: string }[];
  const body = (await res.json()) as { data?: { embedding?: number[] }[] };
  const embedding = body.data?.[0]?.embedding;
  if (!embedding?.length) return [];
  const { data, error } = await admin.rpc("match_handbook_chunks", {
    query_embedding: embedding,
    match_persona: "staff",
    match_count: 5,
  });
  if (error) return [];
  return (data ?? []) as { section_title: string; content?: string }[];
}

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? process.env.STAGING_APP_URL ?? "").replace(/\/$/, "");
const QUESTIONS = [
  "I bought a floor scrubbing machine with company money, how do I record it?",
  "I bought a monitor on credit, how do I record it?",
  "How do supplier contracts work?",
];

async function signInCookie(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "sign-in failed");
  const projectRef = new URL(url).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  return `${cookieName}=${encodeURIComponent(JSON.stringify({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    token_type: "bearer",
    user: data.session.user,
  }))}`;
}

function vercelBypassHeaders(): Record<string, string> {
  const bypass =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
    (APP_URL.includes("vercel.app") ? "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq" : "");
  return bypass ? { "x-vercel-protection-bypass": bypass } : {};
}

async function askAssistant(cookie: string, message: string): Promise<string> {
  if (!APP_URL) return "(skipped — set APP_URL or STAGING_APP_URL)";
  const response = await fetch(`${APP_URL}/api/assistant/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...vercelBypassHeaders(),
    },
    body: JSON.stringify({ message, conversationHistory: [] }),
  });
  const payload = (await response.json().catch(() => null)) as { reply?: string; error?: string } | null;
  if (!response.ok) return `(HTTP ${response.status}) ${payload?.error ?? "error"}`;
  return payload?.reply ?? "(empty)";
}

async function main() {
  const label = process.argv.find((a) => a.startsWith("--label="))?.split("=")[1] ?? "run";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const voyageKey = process.env.VOYAGE_API_KEY ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii")) throw new Error("Staging only");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stamp = Date.now();
  const email = `asset-guide.${stamp}@test.davors`;
  const password = `AssetGuide-${stamp}!Aa8`;
  const tenantId = "00000001-0000-4000-8000-000000000001";

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr;
  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: tenantId,
    role: "super_admin",
    is_active: true,
  });

  const cookie = await signInCookie(email, password);
  console.log(`\n=== Assistant asset handbook test (${label}) ===\n`);

  for (const q of QUESTIONS) {
    console.log(`Q: ${q}`);
    if (voyageKey) {
      const chunks = await retrieveRag(admin, q, voyageKey);
      console.log("RAG sections:", chunks.map((c) => c.section_title).join(" | ") || "(none)");
    }
    const reply = await askAssistant(cookie, q);
    console.log("A:", reply.slice(0, 1200), reply.length > 1200 ? "…" : "");
    console.log("---");
  }

  await admin.from("user_accounts").delete().eq("auth_uid", userData.user.id);
  await admin.auth.admin.deleteUser(userData.user.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
