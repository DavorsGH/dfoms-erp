/**
 * Staging E2E: landlord recovery action_link → Location hash (#access_token + type=recovery)
 * → setSession → updateUser password → signInWithPassword.
 *
 * Also unit-tests establishRecoverySessionFromUrl hash path via a mock window + client.
 *
 *   npx tsx scripts/_test-landlord-reset-password-hash-staging.ts
 *   npx tsx scripts/_test-landlord-reset-password-hash-staging.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import { establishRecoverySessionFromUrl } from "../utils/auth/establish-recovery-session";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const REDIRECT_TO = "http://localhost:3000/landlord-portal/reset-password";
const INITIAL_PASSWORD = "LandlordReset-Init-7Kx9!";
const NEW_PASSWORD = "LandlordReset-New-9Qx2!";

function pass(label: string) {
  console.log(`PASS — ${label}`);
}

function anonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

function summarizeHashShape(locationHref: string) {
  const hashIdx = locationHref.indexOf("#");
  const hash = hashIdx >= 0 ? locationHref.slice(hashIdx + 1) : "";
  const params = new URLSearchParams(hash);
  const keys = [...params.keys()];
  return {
    hasHash: hashIdx >= 0,
    hashPrefix: hash.slice(0, 80) + (hash.length > 80 ? "…" : ""),
    keys,
    hasAccessToken: params.has("access_token"),
    hasRefreshToken: params.has("refresh_token"),
    type: params.get("type"),
    hasTokenHashInHash: params.has("token_hash"),
    hasCodeInHash: params.has("code"),
    searchHasTokenHash: new URL(locationHref.split("#")[0]!).searchParams.has(
      "token_hash",
    ),
    searchHasCode: new URL(locationHref.split("#")[0]!).searchParams.has("code"),
  };
}

async function followActionLinkForLocation(actionLink: string) {
  // Supabase verify may 302 once or twice; follow manually and keep the first
  // Location that lands on our app (or any Location with a hash).
  let current = actionLink;
  let lastLocation: string | null = null;
  let lastStatus = 0;

  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    lastStatus = res.status;
    const location = res.headers.get("location");
    console.log(
      `  hop ${hop}: HTTP ${res.status} location=${location ? location.slice(0, 160) + (location.length > 160 ? "…" : "") : "(none)"}`,
    );

    if (!location) {
      // Some GoTrue builds return 200 HTML with meta refresh / JS; fall back to final URL if available
      break;
    }

    lastLocation = new URL(location, current).toString();

    // Prefer the redirect that includes the implicit hash fragment
    if (lastLocation.includes("#access_token=")) {
      return { location: lastLocation, status: lastStatus, hops: hop + 1 };
    }

    // Stop when we reach the app redirect (even without hash yet — shouldn't happen)
    if (
      lastLocation.includes("/landlord-portal/reset-password") ||
      lastLocation.includes("localhost:3000")
    ) {
      return { location: lastLocation, status: lastStatus, hops: hop + 1 };
    }

    current = lastLocation;
  }

  assert(lastLocation, `No Location header after following action_link (last HTTP ${lastStatus})`);
  return { location: lastLocation, status: lastStatus, hops: 6 };
}

async function unitTestHashHelperPath() {
  const access_token = "unit-test-access-token";
  const refresh_token = "unit-test-refresh-token";
  const hash = `#access_token=${access_token}&refresh_token=${refresh_token}&type=recovery&expires_in=3600`;

  let setSessionCalled: { access_token: string; refresh_token: string } | null =
    null;

  const mockSupabase = {
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
      setSession: async (tokens: {
        access_token: string;
        refresh_token: string;
      }) => {
        setSessionCalled = tokens;
        return { error: null };
      },
      getSession: async () => ({ data: { session: null } }),
    },
  } as unknown as SupabaseClient;

  const g = globalThis as unknown as {
    window?: {
      location: { search: string; hash: string; href: string };
      history: { replaceState: (...args: unknown[]) => void };
    };
    document?: { title: string };
  };

  const prevWindow = g.window;
  const prevDocument = g.document;

  g.document = { title: "unit" };
  g.window = {
    location: {
      search: "",
      hash,
      href: `http://localhost:3000/landlord-portal/reset-password${hash}`,
    },
    history: {
      replaceState: () => undefined,
    },
  };

  try {
    const result = await establishRecoverySessionFromUrl(mockSupabase);
    assert(result.ok, `helper failed: ${!result.ok ? result.error : ""}`);
    assert(setSessionCalled, "setSession was not called");
    assert(
      setSessionCalled!.access_token === access_token &&
        setSessionCalled!.refresh_token === refresh_token,
      "setSession tokens mismatch",
    );
    pass("unit: establishRecoverySessionFromUrl hash → setSession");
  } finally {
    g.window = prevWindow;
    g.document = prevDocument;
  }
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  console.log(`Loaded env: ${envFile}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ref ${STAGING_REF} in URL, got ${url}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(anonKey(), "Missing anon/publishable key");
  pass(`staging ref ${STAGING_REF}`);

  // Optional: staff forgot-password redirect path
  const staffForgot = readFileSync(
    resolve(process.cwd(), "app/forgot-password/page.tsx"),
    "utf8",
  );
  assert(
    staffForgot.includes('redirectTo: `${window.location.origin}/reset-password`') ||
      staffForgot.includes("/reset-password"),
    "staff forgot-password missing /reset-password redirect",
  );
  pass("staff forgot redirect path is /reset-password");

  await unitTestHashHelperPath();

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const stamp = Date.now().toString(36);
  const email = `ll.reset.hash.${stamp}@example.com`;
  let createdUserId: string | null = null;

  try {
    // Prefer creating a disposable Auth user (no landlord row required for Auth recovery)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: INITIAL_PASSWORD,
      email_confirm: true,
      user_metadata: { portal: "landlord", purpose: "reset-password-hash-e2e" },
    });
    assert(!createErr && created.user, createErr?.message ?? "createUser failed");
    createdUserId = created.user.id;
    console.log(`Created temp Auth user ${createdUserId} <${email}>`);

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: REDIRECT_TO },
    });
    assert(
      !linkErr && linkData?.properties?.action_link,
      linkErr?.message ?? "generateLink missing action_link",
    );
    const actionLink = linkData.properties.action_link as string;
    console.log(`action_link (truncated): ${actionLink.slice(0, 120)}…`);
    pass("generateLink recovery with redirectTo landlord reset-password");

    const { location, status, hops } = await followActionLinkForLocation(actionLink);
    console.log(`Final Location (HTTP ${status}, hops=${hops}):`);
    console.log(`  ${location.slice(0, 200)}${location.length > 200 ? "…" : ""}`);

    const shape = summarizeHashShape(location);
    console.log("URL shape:", JSON.stringify(shape, null, 2));

    assert(shape.hasHash, "Expected Location to include a # hash fragment");
    assert(
      location.includes("#access_token="),
      "Expected Location hash to contain #access_token=",
    );
    assert(shape.type === "recovery", `Expected type=recovery, got ${shape.type}`);
    assert(!shape.searchHasTokenHash, "Did NOT expect query token_hash");
    assert(!shape.searchHasCode, "Did NOT expect query code (PKCE)");
    assert(!shape.hasTokenHashInHash, "Did NOT expect token_hash in hash");
    assert(!shape.hasCodeInHash, "Did NOT expect code in hash");
    assert(shape.hasRefreshToken, "Expected refresh_token in hash");
    pass("Location shape: #access_token= + type=recovery (not token_hash, not code)");

    const hashParams = new URLSearchParams(
      location.includes("#") ? location.slice(location.indexOf("#") + 1) : "",
    );
    const access_token = hashParams.get("access_token");
    const refresh_token = hashParams.get("refresh_token");
    assert(access_token && refresh_token, "Missing tokens in hash");

    // Same path the helper uses for implicit recovery
    const { error: sessionErr } = await anon.auth.setSession({
      access_token,
      refresh_token,
    });
    assert(!sessionErr, sessionErr?.message ?? "setSession failed");
    pass("anon setSession from hash tokens");

    const { error: updateErr } = await anon.auth.updateUser({
      password: NEW_PASSWORD,
    });
    assert(!updateErr, updateErr?.message ?? "updateUser password failed");
    pass("updateUser password to known new password");

    await anon.auth.signOut();

    const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
      email,
      password: NEW_PASSWORD,
    });
    assert(
      !signInErr && signInData.user,
      signInErr?.message ?? "signInWithPassword with new password failed",
    );
    pass("signInWithPassword with new password");

    await anon.auth.signOut();

    console.log("\nALL LANDLORD RESET-PASSWORD HASH STAGING CHECKS PASSED");
    console.log(
      `Finding: staging GoTrue recovery redirect Location uses implicit hash (#access_token=…&type=recovery), not token_hash or PKCE code.`,
    );
  } finally {
    if (createdUserId) {
      const { error } = await admin.auth.admin.deleteUser(createdUserId);
      if (error) {
        console.warn(`Cleanup warning: deleteUser ${createdUserId}: ${error.message}`);
      } else {
        console.log(`Cleaned up Auth user ${createdUserId}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("\nFAIL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
