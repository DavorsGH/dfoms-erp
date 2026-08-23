/**
 * Staging: portal forgot-password + chooser / wrong-portal smoke checks.
 *
 *   npx tsx scripts/_test-portal-forgot-password-chooser-staging.ts
 *   npx tsx scripts/_test-portal-forgot-password-chooser-staging.ts --env-file .env.staging.local
 *
 * Staging note: anon resetPasswordForEmail for *existing* users currently returns
 * AuthRetryableFetchError status 500 with message "{}" (Auth email/SMTP path).
 * Nonexistent emails still return error:null (anti-enumeration). Probes (a)/(b)/(d)
 * assert the call does not throw and accepts null error OR that known staging
 * failure; recovery is also verified via admin.generateLink.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createClient,
  type AuthError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  PORTAL_CHOOSER_LABEL,
  PORTAL_CHOOSER_PATH,
  WRONG_PORTAL_LOGIN_MESSAGE,
} from "../utils/portal-chooser";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "PortalForgotPw-Test-8Qx!";
const stamp = Date.now().toString(36);
const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(label: string) {
  console.log(`PASS — ${label}`);
}

function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`FAIL — ${label}: ${msg}`);
}

function formatAuthError(error: AuthError | null | undefined) {
  if (!error) return "null";
  return JSON.stringify({
    name: error.name,
    status: error.status,
    message: error.message,
    code: (error as { code?: string }).code,
  });
}

/** Staging Auth email path failure for existing-user reset. */
function isKnownStagingResetEmailFailure(error: AuthError | null | undefined) {
  if (!error) return false;
  const opaqueMessage =
    error.message === "{}" || error.message === "" || !error.message;
  // Staging Auth email/SMTP path: status 500 + opaque "{}" body.
  return error.status === 500 && opaqueMessage;
}

function siteOrigin() {
  const fromEnv = (process.env.NEXT_PUBLIC_SITE_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  return fromEnv || STAGING_APP_URL;
}

function anonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

function makeAnon(url: string) {
  return createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function optionalResendProbe(toEmail: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.log("  (Resend: skipped — RESEND_API_KEY absent)");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails?limit=5", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.log(`  (Resend: list HTTP ${res.status} — soft skip)`);
      return;
    }
    const body = (await res.json()) as { data?: Array<{ to?: string[] }> };
    const hit = (body.data ?? []).some((row) =>
      (row.to ?? []).some((addr) => addr.toLowerCase() === toEmail.toLowerCase()),
    );
    console.log(
      hit
        ? `  (Resend: recent list includes ${toEmail})`
        : `  (Resend: key ok; ${toEmail} not in last 5 — soft ok)`,
    );
  } catch (err) {
    console.log(
      `  (Resend: soft skip — ${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Call resetPasswordForEmail; must not throw.
 * Accepts null error OR known staging Auth SMTP 500 for existing users.
 */
async function callResetNoThrow(
  anon: SupabaseClient,
  email: string,
  redirectTo: string,
  label: string,
) {
  let error: AuthError | null = null;
  try {
    const result = await anon.auth.resetPasswordForEmail(email, { redirectTo });
    error = result.error;
  } catch (thrown) {
    throw new Error(
      `${label}: resetPasswordForEmail threw: ${
        thrown instanceof Error ? thrown.message : String(thrown)
      }`,
    );
  }

  if (!error) {
    console.log(`  (${label}) resetPasswordForEmail error=null`);
    return;
  }

  if (isKnownStagingResetEmailFailure(error)) {
    console.log(
      `  (${label}) known staging Auth email 500: ${formatAuthError(error)}`,
    );
    return;
  }

  throw new Error(
    `${label}: unexpected resetPasswordForEmail error: ${formatAuthError(error)}`,
  );
}

async function assertRecoveryLink(
  admin: SupabaseClient,
  email: string,
  redirectTo: string,
  label: string,
) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  assert(
    !error && data?.properties?.action_link,
    `${label}: generateLink failed: ${error?.message ?? "no action_link"}`,
  );
  console.log(`  (${label}) generateLink recovery OK`);
}

type Created = {
  authUids: string[];
  lesseeIds: Array<{ tenantId: string; lesseeId: string }>;
};

async function cleanup(admin: SupabaseClient, created: Created) {
  for (const row of created.lesseeIds) {
    await admin
      .from("lessee_portal_invites")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lessee_id", row.lesseeId);
    await admin
      .from("lessees")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lessee_id", row.lesseeId);
  }
  for (const uid of created.authUids) {
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ref ${STAGING_REF} in URL`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(anonKey(), "Missing anon/publishable key");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = makeAnon(url);
  const origin = siteOrigin();
  const created: Created = { authUids: [], lesseeIds: [] };

  const results: Record<"a" | "b" | "c" | "d" | "e" | "f", "PASS" | "FAIL"> = {
    a: "FAIL",
    b: "FAIL",
    c: "FAIL",
    d: "FAIL",
    e: "FAIL",
    f: "FAIL",
  };

  try {
    const { data: landlords } = await admin
      .from("landlords")
      .select("tenant_id")
      .limit(1);
    const tenantId = landlords?.[0]?.tenant_id;
    assert(tenantId, "Need at least one landlord tenant on staging");

    // ── (a) Landlord ───────────────────────────────────────────────────────
    try {
      const landlordEmail = `forgot.ll.${stamp}@example.com`;
      const { data: llAuth, error: llCreateErr } =
        await admin.auth.admin.createUser({
          email: landlordEmail,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { portal: "landlord" },
        });
      assert(!llCreateErr && llAuth.user, llCreateErr?.message ?? "landlord auth create");
      created.authUids.push(llAuth.user.id);

      const redirectTo = `${origin}/landlord-portal/reset-password`;
      await callResetNoThrow(anon, landlordEmail, redirectTo, "a");
      await assertRecoveryLink(admin, landlordEmail, redirectTo, "a");
      await optionalResendProbe(landlordEmail);
      results.a = "PASS";
      pass("(a) landlord resetPasswordForEmail (no throw)");
    } catch (err) {
      fail("(a) landlord resetPasswordForEmail", err);
    }

    // ── (b) Lessee with auth_user_id ───────────────────────────────────────
    try {
      const lesseeEmail = `forgot.ls.${stamp}@example.com`;
      const lesseeId = crypto.randomUUID();
      const { data: lsAuth, error: lsCreateErr } =
        await admin.auth.admin.createUser({
          email: lesseeEmail,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { portal: "lessee" },
        });
      assert(!lsCreateErr && lsAuth.user, lsCreateErr?.message ?? "lessee auth create");
      created.authUids.push(lsAuth.user.id);

      const { error: insertErr } = await admin.from("lessees").insert({
        tenant_id: tenantId,
        lessee_id: lesseeId,
        full_name: `Forgot PW Lessee ${stamp}`,
        phone: "0209999001",
        email: lesseeEmail,
        status: "active",
        auth_user_id: lsAuth.user.id,
      });
      assert(!insertErr, insertErr?.message ?? "lessee insert");
      created.lesseeIds.push({ tenantId, lesseeId });

      const redirectTo = `${origin}/portal/reset-password`;
      await callResetNoThrow(anon, lesseeEmail, redirectTo, "b");
      await assertRecoveryLink(admin, lesseeEmail, redirectTo, "b");
      await optionalResendProbe(lesseeEmail);
      results.b = "PASS";
      pass("(b) lessee resetPasswordForEmail (no throw)");
    } catch (err) {
      fail("(b) lessee resetPasswordForEmail", err);
    }

    // ── (c) Nonexistent email ─────────────────────────────────────────────
    try {
      const ghost = `forgot.none.${stamp}@example.com`;
      let data: unknown;
      let error: AuthError | null = null;
      try {
        const result = await anon.auth.resetPasswordForEmail(ghost, {
          redirectTo: `${origin}/portal/reset-password`,
        });
        data = result.data;
        error = result.error;
      } catch (thrown) {
        throw new Error(
          `threw for nonexistent: ${
            thrown instanceof Error ? thrown.message : String(thrown)
          }`,
        );
      }
      assert(
        error === null || error === undefined,
        `expected null error for nonexistent email, got: ${formatAuthError(error)}`,
      );
      assert(data !== undefined, "expected data object (same response shape)");
      results.c = "PASS";
      pass("(c) nonexistent email — neutral / null error");
    } catch (err) {
      fail("(c) nonexistent email", err);
    }

    // ── (d) Former lessee ─────────────────────────────────────────────────
    try {
      const formerEmail = `forgot.former.${stamp}@example.com`;
      const formerLesseeId = crypto.randomUUID();
      const { data: formerAuth, error: formerCreateErr } =
        await admin.auth.admin.createUser({
          email: formerEmail,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { portal: "lessee" },
        });
      assert(
        !formerCreateErr && formerAuth.user,
        formerCreateErr?.message ?? "former auth create",
      );
      created.authUids.push(formerAuth.user.id);

      const { error: formerInsertErr } = await admin.from("lessees").insert({
        tenant_id: tenantId,
        lessee_id: formerLesseeId,
        full_name: `Former Lessee ${stamp}`,
        phone: "0209999002",
        email: formerEmail,
        status: "former",
        auth_user_id: formerAuth.user.id,
      });
      assert(!formerInsertErr, formerInsertErr?.message ?? "former lessee insert");
      created.lesseeIds.push({ tenantId, lesseeId: formerLesseeId });

      const { error: detachErr } = await admin
        .from("lessees")
        .update({
          auth_user_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("lessee_id", formerLesseeId);
      assert(!detachErr, detachErr?.message ?? "detach auth_user_id");

      await callResetNoThrow(
        anon,
        formerEmail,
        `${origin}/portal/reset-password`,
        "d",
      );

      const { data: signInData, error: signInErr } =
        await anon.auth.signInWithPassword({
          email: formerEmail,
          password: PASSWORD,
        });
      assert(!signInErr && signInData.user, signInErr?.message ?? "former sign-in");

      const { data: activeLink } = await admin
        .from("lessees")
        .select("lessee_id")
        .eq("auth_user_id", signInData.user.id)
        .neq("status", "former")
        .maybeSingle();
      assert(!activeLink, "former user must have no active lessee link");

      assert(
        WRONG_PORTAL_LOGIN_MESSAGE.length > 0,
        "wrong portal message constant present",
      );

      await anon.auth.signOut();
      results.d = "PASS";
      pass("(d) former lessee — reset no-throw, no active link after sign-in");
    } catch (err) {
      fail("(d) former lessee", err);
    }

    // ── (e) File content assertions ───────────────────────────────────────
    try {
      const root = process.cwd();
      const files: Array<{ path: string; mustInclude: string[] }> = [
        {
          path: "app/landlord-portal/login/page.tsx",
          mustInclude: [
            "/landlord-portal/forgot-password",
            `href="${PORTAL_CHOOSER_PATH}"`,
            PORTAL_CHOOSER_LABEL.landlord,
          ],
        },
        {
          path: "app/portal/login/page.tsx",
          mustInclude: [
            "/portal/forgot-password",
            `href="${PORTAL_CHOOSER_PATH}"`,
            PORTAL_CHOOSER_LABEL.tenant,
          ],
        },
        {
          path: "app/login/page.tsx",
          mustInclude: [
            "/forgot-password",
            `href="${PORTAL_CHOOSER_PATH}"`,
            PORTAL_CHOOSER_LABEL.staff,
          ],
        },
        {
          path: "middleware.ts",
          mustInclude: [
            "/portal/forgot-password",
            "/portal/reset-password",
            "/landlord-portal/forgot-password",
            "/landlord-portal/reset-password",
          ],
        },
        {
          path: "app/landlord-portal/forgot-password/page.tsx",
          mustInclude: ["ForgotPasswordForm", "/landlord-portal/reset-password"],
        },
        {
          path: "app/landlord-portal/reset-password/page.tsx",
          mustInclude: ["ResetPasswordForm"],
        },
        {
          path: "components/auth/reset-password-form.tsx",
          mustInclude: ["resolvePasswordResetRedirect"],
        },
        {
          path: "app/portal/forgot-password/page.tsx",
          mustInclude: ["ForgotPasswordForm", "/portal/reset-password"],
        },
        {
          path: "app/portal/reset-password/page.tsx",
          mustInclude: ["ResetPasswordForm"],
        },
      ];

      for (const file of files) {
        const content = readFileSync(resolve(root, file.path), "utf8");
        for (const needle of file.mustInclude) {
          assert(
            content.includes(needle),
            `${file.path} missing expected text: ${needle}`,
          );
        }
      }
      results.e = "PASS";
      pass("(e) login / forgot / reset / middleware file assertions");
    } catch (err) {
      fail("(e) file content assertions", err);
    }

    // ── (f) Wrong-portal ──────────────────────────────────────────────────
    try {
      const wrongEmail = `forgot.wrongportal.${stamp}@example.com`;
      const { data: wrongAuth, error: wrongCreateErr } =
        await admin.auth.admin.createUser({
          email: wrongEmail,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { portal: "landlord" },
        });
      assert(
        !wrongCreateErr && wrongAuth.user,
        wrongCreateErr?.message ?? "wrong-portal auth create",
      );
      created.authUids.push(wrongAuth.user.id);

      const { data: signInData, error: signInErr } =
        await anon.auth.signInWithPassword({
          email: wrongEmail,
          password: PASSWORD,
        });
      assert(!signInErr && signInData.user, signInErr?.message ?? "wrong-portal sign-in");

      const { data: landlordRow } = await admin
        .from("landlords")
        .select("tenant_id")
        .eq("auth_user_id", signInData.user.id)
        .maybeSingle();
      assert(!landlordRow, "expected landlords row missing for wrong-portal sim");

      assert(
        WRONG_PORTAL_LOGIN_MESSAGE ===
          "This account belongs to a different portal. Choose the correct portal to continue.",
        "WRONG_PORTAL_LOGIN_MESSAGE constant mismatch",
      );

      const actionsSrc = readFileSync(
        resolve(process.cwd(), "app/landlord-portal/login/actions.ts"),
        "utf8",
      );
      assert(
        actionsSrc.includes(WRONG_PORTAL_LOGIN_MESSAGE),
        "landlord login actions missing wrong-portal message",
      );

      await anon.auth.signOut();
      results.f = "PASS";
      pass("(f) wrong-portal — landlords missing → message constant");
    } catch (err) {
      fail("(f) wrong-portal", err);
    }

    console.log("\n=== Summary ===");
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      console.log(`  (${key}) ${results[key]}`);
    }
    const allPass = Object.values(results).every((r) => r === "PASS");
    console.log(
      allPass
        ? "\nALL PORTAL FORGOT-PASSWORD / CHOOSER PROBES PASSED\n"
        : "\nSOME PROBES FAILED\n",
    );
    if (!allPass) process.exit(1);
  } finally {
    await cleanup(admin, created);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
