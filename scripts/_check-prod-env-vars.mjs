import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

execFileSync(
  "npx",
  ["vercel", "env", "pull", ".env.vercel.production.pull", "--environment=production", "--yes"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

const env = Object.fromEntries(
  readFileSync(".env.vercel.production.pull", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      let value = line.slice(i + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [line.slice(0, i).trim(), value];
    }),
);

console.log("NEXT_PUBLIC_SITE_URL_OK:", env.NEXT_PUBLIC_SITE_URL === "https://portal.davorsfacilities.com");
console.log("MFA_ENFORCEMENT_OFF:", env.MFA_ENFORCEMENT === "false" || env.MFA_ENFORCEMENT === "" || env.MFA_ENFORCEMENT === undefined);
