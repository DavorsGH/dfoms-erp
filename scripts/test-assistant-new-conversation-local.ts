/**
 * Simulates widget "New conversation" (empty conversationHistory) vs prior turns.
 *   APP_URL=http://localhost:3000 npx tsx scripts/test-assistant-new-conversation-local.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.STAGING_STAFF_EMAIL?.trim() ?? "david.avors@gmail.com";
const PASSWORD = process.env.STAGING_STAFF_PASSWORD?.trim() ?? "";

type HistoryEntry = { role: "user" | "assistant"; content: string };

async function signInCookie(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const adminUrl = process.env.SUPABASE_URL?.trim() ?? url;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (PASSWORD) {
    const { data, error } = await auth.auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
    });
    if (error || !data.session) {
      throw new Error(error?.message ?? "sign-in failed");
    }
    return sessionToCookie(url, data.session);
  }

  if (!serviceKey) {
    throw new Error("Set STAGING_STAFF_PASSWORD or SUPABASE_SERVICE_ROLE_KEY for magic link");
  }
  const admin = createClient(adminUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
    options: { redirectTo: `${APP_URL}/dashboard` },
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(linkError?.message ?? "magic link failed");
  }
  const { data: verifyData, error: verifyError } = await auth.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verifyData.session) {
    throw new Error(verifyError?.message ?? "verifyOtp failed");
  }
  return sessionToCookie(url, verifyData.session);
}

function sessionToCookie(
  url: string,
  session: {
    access_token: string;
    refresh_token?: string | null;
    expires_at?: number;
    expires_in?: number;
    user: unknown;
  },
): string {
  const projectRef = new URL(url).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token ?? "",
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  )}`;
}

async function chat(
  cookie: string,
  message: string,
  conversationHistory: HistoryEntry[],
): Promise<string> {
  const response = await fetch(`${APP_URL}/api/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ message, conversationHistory }),
  });
  const payload = (await response.json()) as { reply?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload.reply?.trim() ?? "";
}

function replySuggestsMemoryOfPriorQuestion(reply: string, priorQuestion: string): boolean {
  const normalized = reply.toLowerCase();
  const prior = priorQuestion.toLowerCase();
  if (normalized.includes(prior)) {
    return true;
  }
  if (
    prior.includes("capital of france") &&
    (normalized.includes("paris") || normalized.includes("capital of france"))
  ) {
    return true;
  }
  if (
    normalized.includes("you asked") ||
    normalized.includes("your previous") ||
    normalized.includes("just asked")
  ) {
    return (
      normalized.includes("france") ||
      normalized.includes("paris") ||
      normalized.includes("capital")
    );
  }
  return false;
}

async function main() {
  const cookie = await signInCookie();
  const firstQuestion = "What is the capital of France? Reply in one short sentence.";

  const firstReply = await chat(cookie, firstQuestion, []);
  console.log("First Q reply:", firstReply.slice(0, 200));

  const withHistory = await chat(cookie, "What did I just ask you?", [
    { role: "user", content: firstQuestion },
    { role: "assistant", content: firstReply },
  ]);
  const remembersWithHistory = replySuggestsMemoryOfPriorQuestion(
    withHistory,
    firstQuestion,
  );
  console.log("\nWith history — remembers prior question:", remembersWithHistory);
  console.log("Reply excerpt:", withHistory.slice(0, 280));

  const afterReset = await chat(cookie, "What did I just ask you?", []);
  const remembersAfterReset = replySuggestsMemoryOfPriorQuestion(
    afterReset,
    firstQuestion,
  );
  console.log("\nAfter reset (empty history) — remembers prior question:", remembersAfterReset);
  console.log("Reply excerpt:", afterReset.slice(0, 280));

  if (!remembersWithHistory) {
    console.warn("\nWARN: model did not recall prior turn even with history (flaky).");
  }
  if (remembersAfterReset) {
    console.error("\nFAIL: assistant still appears to know the prior question after reset.");
    process.exit(1);
  }
  console.log("\nPASS: empty conversationHistory after reset (widget Start new behaviour).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
