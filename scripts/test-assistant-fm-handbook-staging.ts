/**
 * Staging verification: staff RAG (AI Assistant / void / quote conversion)
 * and Facility Manager live tool call via /api/assistant/chat.
 *
 *   node scripts/_run-with-staging-env.mjs npx next dev -p 3000
 *   APP_URL=http://localhost:3000 npx tsx scripts/test-assistant-fm-handbook-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const FM_EMAIL = "david.avors+fm@gmail.com";
const FM_PASSWORD =
  process.env.FM_TEST_PASSWORD?.trim() ?? "FmStagingTest!2026";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}: ${detail}`);
}

async function signInCookie(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !anon) {
    throw new Error("Staging Supabase anon credentials required");
  }
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  }
  const projectRef = new URL(url).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: "bearer",
      user: data.session.user,
    }),
  );
  return `${cookieName}=${cookieValue}`;
}

async function createProbeStaff(
  url: string,
  serviceKey: string,
): Promise<{ email: string; password: string; authUid: string; cleanup: () => Promise<void> }> {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `handbook-rag.${stamp}@test.davors`;
  const password = `HandbookRag-${stamp}!Aa8`;
  const tenantId = "00000001-0000-4000-8000-000000000001";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "createUser failed");
  }
  const authUid = data.user.id;
  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    tenant_id: tenantId,
    role: "super_admin",
    is_active: true,
  });
  if (accountError) {
    await admin.auth.admin.deleteUser(authUid);
    throw new Error(accountError.message);
  }

  return {
    email,
    password,
    authUid,
    cleanup: async () => {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    },
  };
}

async function askAssistant(
  cookie: string,
  message: string,
): Promise<{ reply?: string; error?: string; status: number }> {
  const response = await fetch(`${APP_URL}/api/assistant/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ message, conversationHistory: [] }),
  });
  const payload = (await response.json().catch(() => null)) as {
    reply?: string;
    error?: string;
  } | null;
  return {
    status: response.status,
    reply: payload?.reply,
    error: payload?.error,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !serviceKey) {
    throw new Error("Staging service credentials required");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { count } = await admin
    .from("handbook_chunks")
    .select("id", { count: "exact", head: true });
  console.log(`handbook_chunks count: ${count ?? 0}`);

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

  const staff = await createProbeStaff(url, serviceKey);
  try {
    // Ensure FM password is known
    const { data: fm } = await admin
      .from("facility_managers")
      .select("auth_user_id")
      .eq("email", FM_EMAIL.toLowerCase())
      .eq("status", "active")
      .maybeSingle();
    if (fm?.auth_user_id) {
      await admin.auth.admin.updateUserById(fm.auth_user_id as string, {
        password: FM_PASSWORD,
        email_confirm: true,
      });
    }

    const staffCookie = await signInCookie(staff.email, staff.password);

    const aiQ = await askAssistant(
      staffCookie,
      "What can the AI Assistant do? Does it create or delete records?",
    );
    const aiReply = (aiQ.reply ?? "").toLowerCase();
    record(
      "1. Staff RAG — AI Assistant section",
      aiQ.status === 200 &&
        Boolean(aiQ.reply) &&
        (aiReply.includes("does not create") ||
          aiReply.includes("does not") ||
          aiReply.includes("role-based") ||
          aiReply.includes("own workspace")),
      `status=${aiQ.status} snippet=${(aiQ.reply ?? aiQ.error ?? "").slice(0, 180)}`,
    );

    const voidQ = await askAssistant(
      staffCookie,
      "How do I void a client invoice after it has been sent?",
    );
    const voidReply = (voidQ.reply ?? "").toLowerCase();
    record(
      "2. Staff RAG — invoice void",
      voidQ.status === 200 &&
        Boolean(voidQ.reply) &&
        (voidReply.includes("void") || voidReply.includes("voided")),
      `status=${voidQ.status} snippet=${(voidQ.reply ?? voidQ.error ?? "").slice(0, 180)}`,
    );

    const quoteQ = await askAssistant(
      staffCookie,
      "How does Convert to Invoice work for an accepted client quotation?",
    );
    const quoteReply = (quoteQ.reply ?? "").toLowerCase();
    record(
      "3. Staff RAG — quote to invoice",
      quoteQ.status === 200 &&
        Boolean(quoteQ.reply) &&
        (quoteReply.includes("convert") ||
          quoteReply.includes("invoice") ||
          quoteReply.includes("accepted")),
      `status=${quoteQ.status} snippet=${(quoteQ.reply ?? quoteQ.error ?? "").slice(0, 180)}`,
    );

    const fmCookie = await signInCookie(FM_EMAIL, FM_PASSWORD);
    const propsQ = await askAssistant(
      fmCookie,
      "What properties am I assigned to?",
    );
    const propsReply = propsQ.reply ?? propsQ.error ?? "";
    record(
      "4. FM tool — assigned properties",
      propsQ.status === 200 &&
        Boolean(propsQ.reply) &&
        !propsReply.toLowerCase().includes("coming soon") &&
        (propsReply.toLowerCase().includes("propert") ||
          propsReply.toLowerCase().includes("assigned")),
      `status=${propsQ.status} snippet=${propsReply.slice(0, 220)}`,
    );
  } finally {
    await staff.cleanup();
  }

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
