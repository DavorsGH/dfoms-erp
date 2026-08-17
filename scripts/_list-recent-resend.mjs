import { readFileSync } from "node:fs";

function loadEnv(file) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

loadEnv(".env.staging.local");
const apiKey = process.env.RESEND_API_KEY ?? "";
const response = await fetch("https://api.resend.com/emails?limit=15", {
  headers: { Authorization: `Bearer ${apiKey}` },
});
console.log("list_status", response.status);
const body = await response.json();
for (const row of body.data ?? []) {
  console.log(row.created_at, row.subject, JSON.stringify(row.to));
}
