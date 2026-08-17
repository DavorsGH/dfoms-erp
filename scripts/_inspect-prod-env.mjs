import { readFileSync } from "node:fs";

const text = readFileSync(".env.vercel.production.pull", "utf8");
for (const key of ["NEXT_PUBLIC_SITE_URL", "MFA_ENFORCEMENT"]) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) {
    console.log(`${key}: missing`);
    continue;
  }
  let value = line.slice(key.length + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  console.log(`${key}_len:`, value.length);
  console.log(`${key}_is_portal:`, value === "https://portal.davorsfacilities.com");
  console.log(`${key}_is_true:`, value === "true");
  console.log(`${key}_is_false:`, value === "false");
  console.log(`${key}_is_sensitive_placeholder:`, value === "[SENSITIVE]");
}
