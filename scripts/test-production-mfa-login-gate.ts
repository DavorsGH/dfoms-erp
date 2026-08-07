/**
 * Verify production MFA login gate for enrolled vs unenrolled users.
 * Reads production user_mfa_settings directly — same decision inputs as post-login.
 *
 * Usage: npx tsx scripts/test-production-mfa-login-gate.ts
 */
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";
import { loadEnvForce } from "./lib/env";

const INFO_CAANTA_UID = "f8abae4f-f512-40b3-a072-acf8c934b42e";
const DAVID_UID = "36bec926-2801-47bf-aa52-d6ab62dcdb8d";

type SettingsRow = {
  auth_uid: string;
  method: string;
  sms_phone_e164: string | null;
};

function evaluateGate(settings: SettingsRow | null, enforcementOn: boolean) {
  if (!enforcementOn) return { mfaRequired: false, reason: "enforcement off" };
  const method = settings?.method ?? "none";
  if (method === "none") return { mfaRequired: false, reason: "method none" };
  if (method === "totp") return { mfaRequired: true, method: "totp" };
  if (method === "sms") {
    return {
      mfaRequired: true,
      method: "sms",
      maskedPhone: settings?.sms_phone_e164 ?? null,
    };
  }
  return { mfaRequired: false, reason: "unknown method" };
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("tvcurcnmasnocwdxzgvz")) {
    throw new Error("Refusing: not production env");
  }

  const { client: pg } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
  });

  try {
    const { rows } = await pg.query(
      `SELECT auth_uid, method, sms_phone_e164
       FROM public.user_mfa_settings
       WHERE auth_uid = ANY($1::uuid[])`,
      [[INFO_CAANTA_UID, DAVID_UID]],
    );

    const byUid = new Map(
      (rows as SettingsRow[]).map((r) => [r.auth_uid, r]),
    );

    console.log("=== With MFA_ENFORCEMENT=false (current production) ===");
    for (const [label, uid] of [
      ["info@caanta.com", INFO_CAANTA_UID],
      ["david.avors@gmail.com", DAVID_UID],
    ] as const) {
      console.log(
        JSON.stringify({
          label,
          settings: byUid.get(uid) ?? { method: "none" },
          gate: evaluateGate(byUid.get(uid) ?? null, false),
        }),
      );
    }

    console.log("\n=== With MFA_ENFORCEMENT=true (required for login challenge) ===");
    for (const [label, uid] of [
      ["info@caanta.com", INFO_CAANTA_UID],
      ["david.avors@gmail.com", DAVID_UID],
    ] as const) {
      console.log(
        JSON.stringify({
          label,
          settings: byUid.get(uid) ?? { method: "none" },
          gate: evaluateGate(byUid.get(uid) ?? null, true),
        }),
      );
    }

    const caantaGate = evaluateGate(byUid.get(INFO_CAANTA_UID) ?? null, true);
    if (!("mfaRequired" in caantaGate) || !caantaGate.mfaRequired) {
      throw new Error(
        `info@caanta.com should require MFA when enrolled + enforcement on; got ${JSON.stringify(caantaGate)}`,
      );
    }

    const davidGate = evaluateGate(byUid.get(DAVID_UID) ?? null, true);
    if ("mfaRequired" in davidGate && davidGate.mfaRequired) {
      throw new Error(
        `david.avors@gmail.com should not require MFA (method none); got ${JSON.stringify(davidGate)}`,
      );
    }

    console.log(
      "\nPASS — DB state supports login challenge for enrolled users when enforcement is enabled",
    );
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
});
