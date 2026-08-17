import { loadEnvFromArgv, assert } from "./lib/env";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

loadEnvFromArgv(process.argv.slice(2));
const email = process.argv.find((a) => a.includes("@")) ?? "";
assert(email, "email arg required");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: linkData, error } = await admin.auth.admin.generateLink({
  type: "signup",
  email,
  password: "LandlordE2E-Staging-7Kx9!",
});

assert(!error && linkData?.properties?.hashed_token, error?.message ?? "generateLink failed");

const raw = execFileSync(
  "npx",
  ["vercel", "env", "pull", ".env.vercel.preview.tmp", "--environment", "preview", "--yes"],
  { encoding: "utf8", shell: process.platform === "win32" },
);

function getSiteUrl() {
  const pull = require("node:fs").readFileSync(".env.vercel.preview.tmp", "utf8");
  for (const line of pull.split(/\r?\n/)) {
    if (line.startsWith("NEXT_PUBLIC_SITE_URL=")) {
      let v = line.slice("NEXT_PUBLIC_SITE_URL=".length).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return v.replace(/\/$/, "");
    }
  }
  return "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";
}

const site = getSiteUrl();
console.log(
  `${site}/landlord-portal/verify-email?token_hash=${linkData.properties.hashed_token}&type=signup`,
);
