/**
 * Unit checks for resolvePublicSiteUrl / resolveSiteUrlFromRequest localhost guard.
 * Usage: npx tsx scripts/test-public-site-url.ts
 */
import {
  isLocalhostSiteUrl,
  PRODUCTION_PORTAL_SITE_URL,
  resolvePublicSiteUrl,
  resolveSiteUrlFromRequest,
} from "../utils/public-site-url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const next = overrides[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(saved)) {
      const prev = saved[key];
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}

async function main() {
  assert(isLocalhostSiteUrl("http://localhost:3000"), "localhost detect");
  assert(isLocalhostSiteUrl("127.0.0.1:3000"), "127 detect");
  assert(!isLocalhostSiteUrl("https://portal.davorsfacilities.com"), "prod ok");

  withEnv(
    { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" },
    () => {
      assert(
        resolvePublicSiteUrl() === PRODUCTION_PORTAL_SITE_URL,
        "production blocks localhost NEXT_PUBLIC_SITE_URL",
      );
    },
  );

  withEnv({ NODE_ENV: "production" }, () => {
    const req = new Request("http://localhost:3000/api/test", {
      headers: { host: "localhost:3000", "x-forwarded-proto": "http" },
    });
    assert(
      resolveSiteUrlFromRequest(req) === PRODUCTION_PORTAL_SITE_URL,
      "production blocks localhost request host",
    );
  });

  withEnv(
    { NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" },
    () => {
      assert(
        resolvePublicSiteUrl() === "http://localhost:3000",
        "development keeps localhost",
      );
    },
  );

  console.log("PASS public-site-url guards");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
