import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnv() {
  const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    if (!process.env[trimmed.slice(0, i).trim()]) {
      process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
    }
  }
}

loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const parsed = new URL(databaseUrl);
const password = decodeURIComponent(parsed.password);
const ref = "tvcurcnmasnocwdxzgvz";

const regions = [
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "ca-central-1",
  "sa-east-1",
];

const prefixes = ["aws-0", "aws-1"];

async function tryConnect(connectionString) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  await client.query("select 1 as ok");
  await client.end();
}

async function main() {
  try {
    await tryConnect(databaseUrl);
    console.log("Direct DATABASE_URL works");
    return;
  } catch (error) {
    console.log(
      "Direct connection failed:",
      error instanceof Error ? error.message : String(error),
    );
  }

  for (const prefix of prefixes) {
    for (const region of regions) {
      const host = `${prefix}-${region}.pooler.supabase.com`;
      const poolerUrl = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
      try {
        await tryConnect(poolerUrl);
        console.log("Session pooler works:", host);

        const envPath = resolve(process.cwd(), ".env.local");
        const contents = readFileSync(envPath, "utf8");
        const updated = contents.includes("DATABASE_URL=")
          ? contents.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${poolerUrl}`)
          : `${contents.trimEnd()}\nDATABASE_URL=${poolerUrl}\n`;
        writeFileSync(envPath, updated, "utf8");
        console.log("Updated .env.local DATABASE_URL to session pooler URI");
        return;
      } catch (error) {
        const message =
          error instanceof Error ? error.message.split("\n")[0] : String(error);
        if (!message.includes("tenant/user") && !message.includes("ENOTFOUND")) {
          console.log(`Pooler ${host} failed:`, message.slice(0, 120));
        }
      }
    }
  }

  const ipv6Host = "2a05:d016:2b6:b301:dbc4:ccfa:19de:7d48";
  const ipv6Url = `postgresql://postgres:${encodeURIComponent(password)}@[${ipv6Host}]:5432/postgres?sslmode=require`;
  try {
    await tryConnect(ipv6Url);
    console.log("IPv6 direct connection works");
    const envPath = resolve(process.cwd(), ".env.local");
    const contents = readFileSync(envPath, "utf8");
    const updated = contents.replace(
      /^DATABASE_URL=.*$/m,
      `DATABASE_URL=${ipv6Url}`,
    );
    writeFileSync(envPath, updated, "utf8");
    console.log("Updated .env.local DATABASE_URL to IPv6 direct URI");
    return;
  } catch (error) {
    console.log(
      "IPv6 direct failed:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
  }

  throw new Error("No working database connection found");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
