/**
 * Staging assistant E2E: handbook + scorecard prompts.
 *
 *   APP_URL=http://localhost:3000 npx tsx scripts/test-assistant-handbook-prompts-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const STAGING_REF = "wieflwbfdmjtsdnwbfii";

const SUPER_EMAIL = process.env.STAGING_SUPER_ADMIN_EMAIL?.trim() ?? "";
const SUPER_PASSWORD = process.env.STAGING_SUPER_ADMIN_PASSWORD?.trim() ?? "";
const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";

const PROMPTS_SUPER: Array<{ id: string; message: string }> = [
  { id: "a", message: "How do I set a monthly budget?" },
  { id: "b", message: "How do I copy last month's budget?" },
  { id: "c", message: "What does tax to set aside mean on the scorecard?" },
  { id: "d", message: "Can we pay a dividend this quarter?" },
  { id: "d2", message: "How do I pay a dividend?" },
  { id: "e", message: "What's our profit after tax for September?" },
  {
    id: "f",
    message: "Why does Central University show zero on Contract Profitability?",
  },
  {
    id: "g",
    message: "How do I record money one business unit paid for another?",
  },
  { id: "h", message: "How do I issue bleach to a site?" },
];

const PROMPT_FINANCE = {
  id: "i",
  message: "Can we pay a dividend this quarter?",
};

async function signInCookie(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anon) {
    throw new Error("Missing Supabase anon env for sign-in");
  }
  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message ?? `Sign-in failed for ${email}`);
  }
  const access = data.session.access_token;
  const refresh = data.session.refresh_token ?? "";
  const projectRef = new URL(url).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: access,
      refresh_token: refresh,
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: "bearer",
      user: data.session.user,
    }),
  )}`;
}

async function askAssistant(
  cookie: string,
  message: string,
): Promise<string> {
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
  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return payload?.reply?.trim() ?? "(empty reply)";
}

async function createSuperAdminProbe(
  admin: ReturnType<typeof createClient>,
): Promise<{ email: string; password: string; cleanup: () => Promise<void> }> {
  const stamp = Date.now();
  const email = `super-probe.${stamp}@test.davors`;
  const password = `SuperProbe-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "createUser super probe failed");
  }
  const authUid = data.user.id;
  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    tenant_id: DAVORS_TENANT,
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
    cleanup: async () => {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    },
  };
}

async function createFinanceProbe(
  admin: ReturnType<typeof createClient>,
): Promise<{ email: string; password: string; cleanup: () => Promise<void> }> {
  const stamp = Date.now();
  const email = `finance-probe.${stamp}@test.davors`;
  const password = `FinanceProbe-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "createUser finance probe failed");
  }
  const authUid = data.user.id;
  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    tenant_id: DAVORS_TENANT,
    role: "finance",
    is_active: true,
  });
  if (accountError) {
    await admin.auth.admin.deleteUser(authUid);
    throw new Error(accountError.message);
  }
  return {
    email,
    password,
    cleanup: async () => {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    },
  };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!supabaseUrl.includes(STAGING_REF)) {
    throw new Error("Refusing: NEXT_PUBLIC_SUPABASE_URL must be staging.");
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.staging.local");
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`APP_URL=${APP_URL}\n`);

  const superProbe =
    SUPER_EMAIL && SUPER_PASSWORD
      ? null
      : await createSuperAdminProbe(admin);
  const superEmail = SUPER_EMAIL || superProbe!.email;
  const superPassword = SUPER_PASSWORD || superProbe!.password;

  try {
    const superCookie = await signInCookie(superEmail, superPassword);
    for (const prompt of PROMPTS_SUPER) {
      console.log(`\n========== ${prompt.id}. ${prompt.message} ==========\n`);
      const reply = await askAssistant(superCookie, prompt.message);
      console.log(reply);
    }

    const financeProbe = await createFinanceProbe(admin);
    try {
      const financeCookie = await signInCookie(
        financeProbe.email,
        financeProbe.password,
      );
      console.log(
        `\n========== ${PROMPT_FINANCE.id}. ${PROMPT_FINANCE.message} (finance role) ==========\n`,
      );
      const reply = await askAssistant(financeCookie, PROMPT_FINANCE.message);
      console.log(reply);
    } finally {
      await financeProbe.cleanup();
    }
  } finally {
    if (superProbe) {
      await superProbe.cleanup();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
