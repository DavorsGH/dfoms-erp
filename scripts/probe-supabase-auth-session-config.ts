/**
 * Read Supabase Auth session settings (JWT + refresh token lifetime).
 *
 * Usage:
 *   npx tsx scripts/probe-supabase-auth-session-config.ts staging
 *   npx tsx scripts/probe-supabase-auth-session-config.ts production
 */
import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";

const PROJECT_REFS = {
  staging: "wieflwbfdmjtsdnwbfii",
  production: "tvcurcnmasnocwdxzgvz",
} as const;

type Target = keyof typeof PROJECT_REFS;

async function fetchManagementAuthConfig(
  projectRef: string,
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`Management API ${response.status}: ${body.slice(0, 500)}`);
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

function pickSessionFields(config: Record<string, unknown>) {
  const keys = [
    "jwt_exp",
    "refresh_token_rotation_enabled",
    "security_refresh_token_reuse_interval",
    "sessions_timebox",
    "sessions_inactivity_timeout",
    "session_timebox",
    "refresh_token_lifetime",
  ];

  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (config[key] != null) {
      picked[key] = config[key];
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (
      /refresh|session|jwt|expir|timebox|lifetime|ttl/i.test(key) &&
      picked[key] == null
    ) {
      picked[key] = value;
    }
  }

  return picked;
}

async function main() {
  const target = (process.argv[2] ?? "staging") as Target;
  if (!(target in PROJECT_REFS)) {
    throw new Error(`Unknown target "${target}". Use staging or production.`);
  }

  loadEnvForce(resolve(process.cwd(), ".env.local"));
  if (target === "staging") {
    loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  }

  const projectRef = PROJECT_REFS[target];
  const accessToken =
    process.env.SUPABASE_ACCESS_TOKEN?.trim() ||
    process.env.SUPABASE_MANAGEMENT_ACCESS_TOKEN?.trim();

  console.log(`=== Supabase Auth session config (${target}: ${projectRef}) ===`);

  if (!accessToken) {
    console.log(
      "SUPABASE_ACCESS_TOKEN not set — cannot query Management API.\n" +
        "Set a personal access token from https://supabase.com/dashboard/account/tokens\n" +
        "then re-run this script.",
    );
    process.exit(1);
  }

  const config = await fetchManagementAuthConfig(projectRef, accessToken);
  if (!config) {
    process.exit(1);
  }

  const sessionFields = pickSessionFields(config);
  console.log(JSON.stringify(sessionFields, null, 2));

  const refreshLifetime =
    (sessionFields.refresh_token_lifetime as number | undefined) ??
    (sessionFields.sessions_timebox as number | undefined) ??
    (sessionFields.session_timebox as number | undefined);

  if (refreshLifetime != null) {
    console.log(
      `\nSuggested AUTH_COOKIE_PERSIST_MAX_AGE_SECONDS=${refreshLifetime} (${Math.round(refreshLifetime / 86400)} days)`,
    );
  } else {
    console.log(
      "\nCould not infer refresh lifetime field — inspect output above for the correct key.",
    );
  }
}

main().catch((error) => {
  console.error("FAIL —", error instanceof Error ? error.message : error);
  process.exit(1);
});
