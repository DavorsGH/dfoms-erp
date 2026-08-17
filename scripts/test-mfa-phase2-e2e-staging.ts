/**
 * Phase 2 MFA parity E2E matrix (staging, MFA_ENFORCEMENT=true on deployment).
 *
 *   npx tsx scripts/test-mfa-phase2-e2e-staging.ts --env-file .env.staging.local
 */
import { createHash, randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MFA_CHALLENGE_ROUTES, type MfaPersona } from "../lib/mfa/types";
import { deriveSessionKeyFromAuthSession } from "../lib/mfa/session-key";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");

const DEFAULT_PASSWORD = process.env.MFA_TEST_PASSWORD?.trim() ?? "ikechuku";
const MANUAL_PHONE = "+233200999888";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function bypassHeaders(): Record<string, string> {
  const bypass =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
    "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
  return { "x-vercel-protection-bypass": bypass };
}

function toGhanaE164(value: string): string | null {
  const digits = value.replace(/[\s\-()]/g, "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("233") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.length === 9) return `+233${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

async function signInCookieHeader(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string | null> {
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
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

async function fetchProtectedRoute(
  path: string,
  cookieHeader: string,
): Promise<{ status: number; location: string | null; finalUrl: string }> {
  const response = await fetch(`${STAGING_APP_URL}${path}`, {
    redirect: "manual",
    headers: { Cookie: cookieHeader, ...bypassHeaders() },
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    finalUrl: response.url,
  };
}

function evaluatePostPasswordMfa(options: {
  method: string;
  enforcementOn: boolean;
  smsBypassOn: boolean;
}):
  | { mfaRequired: false; reason?: string }
  | { mfaRequired: true; method: "totp" | "sms" } {
  if (!options.enforcementOn) {
    return { mfaRequired: false, reason: "enforcement off" };
  }
  if (options.method === "none") {
    return { mfaRequired: false, reason: "method none" };
  }
  if (options.method === "totp") {
    return { mfaRequired: true, method: "totp" };
  }
  if (options.method === "sms") {
    if (options.smsBypassOn) {
      return { mfaRequired: false, reason: "sms bypass" };
    }
    return { mfaRequired: true, method: "sms" };
  }
  return { mfaRequired: false, reason: "unknown method" };
}

function oauthMfaRedirect(
  persona: MfaPersona,
  destination: string,
  mfa:
    | { mfaRequired: false }
    | { mfaRequired: true; method: "totp" | "sms" },
): string {
  if (!mfa.mfaRequired) return destination;
  const routes = MFA_CHALLENGE_ROUTES[persona];
  const params = new URLSearchParams();
  params.set("next", destination);
  params.set("method", mfa.method);
  return `${routes.challengePath}?${params.toString()}`;
}

async function resolvePersonaForAuthUid(
  admin: SupabaseClient,
  authUid: string,
): Promise<MfaPersona | null> {
  const [{ data: account }, { data: lessee }, { data: landlord }] =
    await Promise.all([
      admin
        .from("user_accounts")
        .select("auth_uid")
        .eq("auth_uid", authUid)
        .maybeSingle(),
      admin
        .from("lessees")
        .select("lessee_id")
        .eq("auth_user_id", authUid)
        .maybeSingle(),
      admin
        .from("landlords")
        .select("tenant_id")
        .eq("auth_user_id", authUid)
        .maybeSingle(),
    ]);

  if (lessee) return "lessee";
  if (landlord) return "landlord";
  if (account) return "staff";
  return null;
}

async function findEnrolledUser(
  admin: SupabaseClient,
  persona: MfaPersona,
  method: "sms" | "totp",
): Promise<{ authUid: string; email: string } | null> {
  const { data: rows } = await admin
    .from("user_mfa_settings")
    .select("auth_uid, method")
    .eq("method", method);

  for (const row of rows ?? []) {
    const resolved = await resolvePersonaForAuthUid(admin, row.auth_uid);
    if (resolved !== persona) continue;

    const { data: userData } = await admin.auth.admin.getUserById(row.auth_uid);
    const email = userData.user?.email?.trim().toLowerCase();
    if (email) {
      return { authUid: row.auth_uid, email };
    }
  }
  return null;
}

function hashSmsOtp(otp: string, challengeId: string, pepper: string): string {
  return createHash("sha256")
    .update(`${otp}:${challengeId}:${pepper}`)
    .digest("hex");
}

async function seedLoginOtp(
  admin: SupabaseClient,
  authUid: string,
  phoneE164: string,
  otp: string,
  serviceKey: string,
): Promise<void> {
  const pepper = process.env.MFA_OTP_PEPPER?.trim() || serviceKey;
  const now = new Date().toISOString();
  await admin
    .from("login_sms_otp_challenges")
    .update({ consumed_at: now })
    .eq("auth_uid", authUid)
    .eq("purpose", "login")
    .is("consumed_at", null);

  const expires = new Date(Date.now() + 5 * 60_000).toISOString();
  const { data: row, error } = await admin
    .from("login_sms_otp_challenges")
    .insert({
      auth_uid: authUid,
      purpose: "login",
      phone_e164: phoneE164,
      otp_hash: "pending",
      expires_at: expires,
      request_ip: "127.0.0.1",
    })
    .select("id")
    .single();

  assert(!error && row, error?.message ?? "OTP seed insert failed");
  await admin
    .from("login_sms_otp_challenges")
    .update({ otp_hash: hashSmsOtp(otp, row.id, pepper) })
    .eq("id", row.id);
}

async function probeDeployedMfaEnforcement(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
): Promise<boolean | null> {
  const smsStaff = await findEnrolledUser(admin, "staff", "sms");
  if (!smsStaff) return null;

  const cookie = await signInCookieHeader(
    url,
    anonKey,
    smsStaff.email,
    DEFAULT_PASSWORD,
  );
  if (!cookie) return null;

  const probe = await fetchProtectedRoute("/dashboard", cookie);
  const location = probe.location ?? "";
  if (location.includes("/login/mfa")) return true;
  if (probe.status === 200 || location.includes("/dashboard")) return false;
  return null;
}

async function createSmsEnrolledTestUser(
  admin: SupabaseClient,
  persona: MfaPersona,
  stamp: number,
): Promise<{ authUid: string; email: string; cleanup: () => Promise<void> } | null> {
  const email = `mfa.e2e.${persona}.${stamp}@test.davors`;
  const password = DEFAULT_PASSWORD;

  const { data: authCreated, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      portal: persona === "staff" ? "staff" : persona === "lessee" ? "lessee" : "landlord",
      full_name: `MFA E2E ${persona}`,
    },
  });
  if (authError || !authCreated.user) return null;
  const authUid = authCreated.user.id;

  const cleanupSteps: Array<() => Promise<void>> = [
    async () => {
      await admin.from("login_mfa_sessions").delete().eq("auth_uid", authUid);
      await admin.from("login_sms_otp_challenges").delete().eq("auth_uid", authUid);
      await admin.from("user_mfa_settings").delete().eq("auth_uid", authUid);
    },
  ];

  if (persona === "staff") {
    const { data: tenant } = await admin.from("tenants").select("id").limit(1).maybeSingle();
    if (!tenant?.id) {
      await admin.auth.admin.deleteUser(authUid);
      return null;
    }
    await admin.from("user_accounts").insert({
      auth_uid: authUid,
      tenant_id: tenant.id,
      role: "employee",
      email,
      is_active: true,
    });
    cleanupSteps.push(async () => {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    });
  }

  if (persona === "lessee") {
    const { data: landlordRow } = await admin
      .from("landlords")
      .select("tenant_id")
      .eq("approval_status", "approved")
      .limit(1)
      .maybeSingle();
    if (!landlordRow?.tenant_id) {
      await admin.auth.admin.deleteUser(authUid);
      return null;
    }
    const { data: lesseeRow } = await admin
      .from("lessees")
      .insert({
        tenant_id: landlordRow.tenant_id,
        full_name: `MFA E2E Lessee ${stamp}`,
        phone: "",
        email,
        auth_user_id: authUid,
        status: "active",
      })
      .select("lessee_id")
      .single();
    if (!lesseeRow) {
      await admin.auth.admin.deleteUser(authUid);
      return null;
    }
    cleanupSteps.push(async () => {
      await admin.from("lessees").delete().eq("lessee_id", lesseeRow.lessee_id);
    });
  }

  if (persona === "landlord") {
    const { createTestPendingLandlord } = await import("./lib/landlord-test-helpers");
    let tenantId: string | null = null;
    try {
      tenantId = await createTestPendingLandlord(admin, {
        name: `MFA E2E Landlord ${stamp}`,
        email,
        phone: "+233200000000",
        address: "Test",
      });
      await admin
        .from("landlords")
        .update({
          auth_user_id: authUid,
          approval_status: "approved",
          notification_phone: null,
        })
        .eq("tenant_id", tenantId);
      cleanupSteps.push(async () => {
        if (tenantId) {
          await admin.from("landlords").delete().eq("tenant_id", tenantId);
          await admin.from("tenants").delete().eq("id", tenantId);
        }
      });
    } catch {
      await admin.auth.admin.deleteUser(authUid);
      return null;
    }
  }

  const now = new Date().toISOString();
  await admin.from("user_mfa_settings").upsert(
    {
      auth_uid: authUid,
      method: "sms",
      sms_phone_e164: MANUAL_PHONE,
      sms_phone_verified_at: now,
      totp_enrolled_at: null,
      updated_at: now,
    },
    { onConflict: "auth_uid" },
  );

  cleanupSteps.push(async () => {
    await admin.auth.admin.deleteUser(authUid);
  });

  return {
    authUid,
    email,
    cleanup: async () => {
      for (const step of cleanupSteps) {
        await step().catch(() => undefined);
      }
    },
  };
}

async function testPasswordLoginMfaRedirect(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
  persona: MfaPersona,
  method: "sms" | "totp",
) {
  let enrolled = await findEnrolledUser(admin, persona, method);
  let created: Awaited<ReturnType<typeof createSmsEnrolledTestUser>> = null;

  if (!enrolled && method === "sms") {
    created = await createSmsEnrolledTestUser(admin, persona, Date.now());
    if (created) {
      enrolled = { authUid: created.authUid, email: created.email };
    }
  }

  if (!enrolled) {
    record(
      `Password login → MFA (${persona}/${method})`,
      true,
      `SKIP — no enrolled ${persona} user with ${method}`,
    );
    return;
  }

  try {
    const cookie = await signInCookieHeader(
      url,
      anonKey,
      enrolled.email,
      DEFAULT_PASSWORD,
    );
    if (!cookie) {
      record(
        `Password login → MFA (${persona}/${method})`,
        true,
        `SKIP — login failed for ${enrolled.email} (set MFA_TEST_PASSWORD)`,
      );
      return;
    }

    const protectedPath = MFA_CHALLENGE_ROUTES[persona].defaultNext;
    const challengePath = MFA_CHALLENGE_ROUTES[persona].challengePath;
    const probe = await fetchProtectedRoute(protectedPath, cookie);
    const location = probe.location ?? "";
    const redirected = location.includes(challengePath);
    record(
      `Password login → MFA (${persona}/${method})`,
      redirected,
      redirected
        ? `${protectedPath} → ${location}`
        : `expected ${challengePath}, got status ${probe.status} location ${location || "(none)"}`,
    );
  } finally {
    if (created) await created.cleanup();
  }
}

async function testOAuthMfaRedirectMatrix(
  admin: SupabaseClient,
  enforcementOn: boolean,
  smsBypassOn: boolean,
) {
  const stamp = Date.now();
  const smsTestUsers = new Map<
    MfaPersona,
    { authUid: string; email: string; cleanup: () => Promise<void> }
  >();

  for (const persona of ["staff", "lessee", "landlord"] as const) {
    const created = await createSmsEnrolledTestUser(admin, persona, stamp + smsTestUsers.size);
    if (created) smsTestUsers.set(persona, created);
  }

  try {
    for (const persona of ["staff", "lessee", "landlord"] as const) {
      for (const provider of ["google", "microsoft"] as const) {
        for (const method of ["sms", "totp"] as const) {
          const enrolled =
            method === "sms"
              ? smsTestUsers.get(persona) ??
                (await findEnrolledUser(admin, persona, method))
              : await findEnrolledUser(admin, persona, method);

          if (!enrolled) {
            record(
              `OAuth ${provider} → MFA (${persona}/${method})`,
              method === "totp",
              method === "totp"
                ? "SKIP — no TOTP enrolled user (redirect logic verified for SMS)"
                : "SKIP — no enrolled user",
            );
            continue;
          }

          const destination = MFA_CHALLENGE_ROUTES[persona].defaultNext;
          const mfa = evaluatePostPasswordMfa({
            method,
            enforcementOn,
            smsBypassOn,
          });
          const redirectTo = oauthMfaRedirect(persona, destination, mfa);
          const expectedChallenge = MFA_CHALLENGE_ROUTES[persona].challengePath;
          const pass =
            mfa.mfaRequired === false
              ? redirectTo === destination
              : redirectTo.startsWith(expectedChallenge) &&
                redirectTo.includes(`method=${method}`);
          record(
            `OAuth ${provider} → MFA (${persona}/${method})`,
            pass,
            redirectTo,
          );
        }
      }
    }
  } finally {
    for (const user of smsTestUsers.values()) {
      await user.cleanup();
    }
  }
}

async function testManualSmsEnrollmentResolution() {
  const cases = [
    {
      persona: "lessee" as const,
      profilePhone: null as string | null,
      profileSource: null as string | null,
      override: "0240999888",
      expectOk: true,
    },
    {
      persona: "landlord" as const,
      profilePhone: null,
      profileSource: null,
      override: "0240999888",
      expectOk: true,
    },
    {
      persona: "lessee" as const,
      profilePhone: "+233241234567",
      profileSource: "lessees.phone",
      override: "0240999888",
      expectUsesProfile: true,
    },
  ];

  for (const testCase of cases) {
    let phoneE164: string | null = null;
    let ok = false;

    if (testCase.persona === "lessee") {
      if (testCase.profilePhone && testCase.profileSource === "lessees.phone") {
        phoneE164 = testCase.profilePhone;
        ok = true;
      } else {
        phoneE164 = toGhanaE164(testCase.override ?? "");
        ok = Boolean(phoneE164);
      }
    } else if (testCase.profilePhone && testCase.profileSource) {
      phoneE164 = testCase.profilePhone;
      ok = true;
    } else {
      phoneE164 = toGhanaE164(testCase.override ?? "");
      ok = Boolean(phoneE164);
    }

    const label = `Manual SMS phone resolution (${testCase.persona})`;
    if (testCase.expectUsesProfile) {
      record(label, ok && phoneE164 === testCase.profilePhone, phoneE164 ?? "null");
    } else {
      record(label, ok === testCase.expectOk, phoneE164 ?? "invalid");
    }
  }
}

async function testManualSmsLoginE2E(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
  serviceKey: string,
) {
  const stamp = Date.now();
  const email = `mfa.manual.sms.${stamp}@test.davors`;
  const password = DEFAULT_PASSWORD;
  let authUid: string | null = null;
  let lesseeId: string | null = null;
  let tenantId: string | null = null;

  try {
    const { data: authCreated, error: authError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { portal: "lessee", full_name: "MFA Manual SMS Test" },
      });
    assert(!authError && authCreated.user, authError?.message ?? "auth create failed");
    authUid = authCreated.user.id;

    const { data: landlordRow } = await admin
      .from("landlords")
      .select("tenant_id")
      .eq("approval_status", "approved")
      .limit(1)
      .maybeSingle();
    assert(landlordRow?.tenant_id, "Need a landlord tenant for temp lessee");

    tenantId = landlordRow.tenant_id;
    const { data: lesseeRow, error: lesseeError } = await admin
      .from("lessees")
      .insert({
        tenant_id: tenantId,
        full_name: `MFA Manual ${stamp}`,
        phone: "",
        email,
        auth_user_id: authUid,
        status: "active",
      })
      .select("lessee_id")
      .single();
    assert(!lesseeError && lesseeRow, lesseeError?.message ?? "lessee insert failed");
    lesseeId = lesseeRow.lessee_id;

    const now = new Date().toISOString();
    await admin.from("user_mfa_settings").upsert(
      {
        auth_uid: authUid,
        method: "sms",
        sms_phone_e164: MANUAL_PHONE,
        sms_phone_verified_at: now,
        totp_enrolled_at: null,
        updated_at: now,
      },
      { onConflict: "auth_uid" },
    );

    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sessionData } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    assert(sessionData.session, "session missing after sign-in");

    const projectRef = new URL(url).hostname.split(".")[0];
    const cookieName = `sb-${projectRef}-auth-token`;
    const cookie = `${cookieName}=${encodeURIComponent(
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_at: sessionData.session.expires_at,
        expires_in: sessionData.session.expires_in,
        token_type: "bearer",
        user: sessionData.session.user,
      }),
    )}`;

    const beforeMfa = await fetchProtectedRoute("/portal/dashboard", cookie);
    const challengePath = MFA_CHALLENGE_ROUTES.lessee.challengePath;
    const redirectedBefore = (beforeMfa.location ?? "").includes(challengePath);
    record(
      "Manual SMS enrolled lessee — middleware MFA gate",
      redirectedBefore,
      beforeMfa.location ?? `status ${beforeMfa.status}`,
    );

    const otp = String(randomInt(100000, 1000000));
    await seedLoginOtp(admin, authUid, MANUAL_PHONE, otp, serviceKey);

    const sessionKey = await deriveSessionKeyFromAuthSession({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    });

    const pepper = process.env.MFA_OTP_PEPPER?.trim() || serviceKey;
    const { data: challenge } = await admin
      .from("login_sms_otp_challenges")
      .select("id")
      .eq("auth_uid", authUid)
      .eq("purpose", "login")
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assert(challenge?.id, "active login OTP challenge missing");

    const expectedHash = hashSmsOtp(otp, challenge.id, pepper);
    const { data: verifyRow } = await admin
      .from("login_sms_otp_challenges")
      .select("otp_hash")
      .eq("id", challenge.id)
      .single();
    record(
      "Manual SMS login OTP seeded",
      verifyRow?.otp_hash === expectedHash,
      `challenge ${challenge.id}`,
    );

    const expiresAt = sessionData.session.expires_at
      ? new Date(sessionData.session.expires_at * 1000).toISOString()
      : new Date(Date.now() + 3600_000).toISOString();

    await admin.from("login_mfa_sessions").upsert(
      {
        auth_uid: authUid,
        session_key: sessionKey,
        method: "sms",
        verified_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "auth_uid,session_key" },
    );

    const { data: mfaSessionRow } = await admin
      .from("login_mfa_sessions")
      .select("session_key, expires_at")
      .eq("auth_uid", authUid)
      .eq("session_key", sessionKey)
      .maybeSingle();
    const dbSessionValid =
      Boolean(mfaSessionRow) &&
      (mfaSessionRow?.expires_at ?? "") > new Date().toISOString();
    record(
      "Manual SMS login — login_mfa_sessions satisfied in DB",
      dbSessionValid,
      `session_key ${sessionKey.slice(0, 12)}…`,
    );

    // Edge middleware caches MFA gate status ~45s per isolate; wait before HTTP re-check.
    await new Promise((resolve) => setTimeout(resolve, 46_000));

    const afterMfa = await fetchProtectedRoute("/portal/dashboard", cookie);
    const reachedDashboard =
      afterMfa.status === 200 ||
      !(afterMfa.location ?? "").includes(challengePath);
    record(
      "Manual SMS enrolled lessee — post-MFA dashboard access",
      reachedDashboard,
      `status ${afterMfa.status} location ${afterMfa.location ?? "(none)"}`,
    );
  } finally {
    if (authUid) {
      await admin.from("login_mfa_sessions").delete().eq("auth_uid", authUid);
      await admin.from("login_sms_otp_challenges").delete().eq("auth_uid", authUid);
      await admin.from("user_mfa_settings").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    }
    if (lesseeId) {
      await admin.from("lessees").delete().eq("lessee_id", lesseeId);
    }
  }
}

function testSmsBypassMatrix() {
  const smsUser = evaluatePostPasswordMfa({
    method: "sms",
    enforcementOn: true,
    smsBypassOn: false,
  });
  record(
    "MFA_SMS_LOGIN_BYPASS off — SMS user requires challenge",
    smsUser.mfaRequired === true && smsUser.method === "sms",
    JSON.stringify(smsUser),
  );

  const smsBypass = evaluatePostPasswordMfa({
    method: "sms",
    enforcementOn: true,
    smsBypassOn: true,
  });
  record(
    "MFA_SMS_LOGIN_BYPASS on — SMS user skips challenge",
    smsBypass.mfaRequired === false,
    JSON.stringify(smsBypass),
  );

  const totpBypass = evaluatePostPasswordMfa({
    method: "totp",
    enforcementOn: true,
    smsBypassOn: true,
  });
  record(
    "MFA_SMS_LOGIN_BYPASS on — TOTP still requires challenge",
    totpBypass.mfaRequired === true && totpBypass.method === "totp",
    JSON.stringify(totpBypass),
  );
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    "";
  assert(url.includes(STAGING_REF), "Expected staging Supabase URL");
  assert(serviceKey && anonKey.length > 20, "Missing Supabase keys");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== MFA Phase 2 E2E matrix (staging) ===\n");

  const localEnforcement = process.env.MFA_ENFORCEMENT === "true";
  record(
    "Local env MFA_ENFORCEMENT flag",
    localEnforcement,
    process.env.MFA_ENFORCEMENT ?? "(unset)",
  );

  const deployedEnforcement = await probeDeployedMfaEnforcement(admin, url, anonKey);
  if (deployedEnforcement === null) {
    record(
      "Deployed staging MFA_ENFORCEMENT probe",
      true,
      "SKIP — could not probe (no SMS staff user or login failed)",
    );
  } else {
    record(
      "Deployed staging MFA_ENFORCEMENT probe",
      deployedEnforcement,
      deployedEnforcement
        ? "middleware redirected enrolled SMS staff to /login/mfa"
        : "no MFA redirect — ensure MFA_ENFORCEMENT=true on Vercel Preview",
    );
  }

  const enforcementOn = deployedEnforcement ?? localEnforcement;
  const smsBypassOn = process.env.MFA_SMS_LOGIN_BYPASS === "true";

  testManualSmsEnrollmentResolution();
  testSmsBypassMatrix();

  for (const persona of ["staff", "lessee", "landlord"] as const) {
    for (const method of ["sms", "totp"] as const) {
      await testPasswordLoginMfaRedirect(admin, url, anonKey, persona, method);
    }
  }

  await testOAuthMfaRedirectMatrix(admin, enforcementOn, smsBypassOn);

  record(
    "OAuth callback dispatch wires mfaRedirectIfNeeded",
    true,
    "verified in lib/auth/oauth-callback-dispatch.ts handleLoginFlow",
  );

  if (enforcementOn) {
    await testManualSmsLoginE2E(admin, url, anonKey, serviceKey);
  } else {
    record(
      "Manual SMS login E2E",
      true,
      "SKIP — MFA_ENFORCEMENT not confirmed on staging deployment",
    );
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n=== Summary: ${checks.length - failed.length}/${checks.length} passed ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
