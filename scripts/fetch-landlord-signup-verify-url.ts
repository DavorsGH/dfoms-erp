/**
 * Retrieve the landlord signup confirmation URL from Resend for E2E browser tests.
 *
 *   npx tsx scripts/fetch-landlord-signup-verify-url.ts --env-file .env.staging.local landlord.e2e.123@test.davors
 */
import { loadEnvFromArgv, assert } from "./lib/env";

const APP_URL = (process.env.E2E_APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

async function fetchResendEmailBody(apiKey: string, emailId: string) {
  const response = await fetch(`https://api.resend.com/emails/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Resend GET email failed (${response.status})`);
  }
  return (await response.json()) as { html?: string; text?: string };
}

function extractVerifyUrl(content: string): string | null {
  const match = content.match(
    /https?:\/\/[^\s"']+\/landlord-portal\/verify-email\?[^\s"']+/i,
  );
  return match?.[0] ?? null;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const toEmail = process.argv.find((arg) => arg.includes("@"))?.trim();
  assert(toEmail, "Usage: ... <recipient-email>");

  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  assert(apiKey, "RESEND_API_KEY required");

  await new Promise((r) => setTimeout(r, 2000));

  const listResponse = await fetch("https://api.resend.com/emails?limit=30", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert(listResponse.ok, `Resend list failed (${listResponse.status})`);

  const listBody = (await listResponse.json()) as {
    data?: Array<{ id: string; to?: string[] }>;
  };

  const rows = (listBody.data ?? []).filter((row) =>
    (row.to ?? []).some((to) => to.toLowerCase() === toEmail.toLowerCase()),
  );
  assert(rows.length > 0, `No Resend emails found for ${toEmail}`);

  for (const row of rows) {
    const body = await fetchResendEmailBody(apiKey, row.id);
    const content = body.html ?? body.text ?? "";
    const url = extractVerifyUrl(content);
    if (url) {
      const normalized = url.replace(
        /^https?:\/\/[^/]+/,
        APP_URL,
      );
      console.log(normalized);
      return;
    }
  }

  throw new Error("Confirmation emails found but no verify URL in body");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
