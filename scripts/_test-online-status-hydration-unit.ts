/**
 * Unit: useOnlineStatus must default to online for SSR/hydration parity.
 * We can't render React hooks in plain node without a harness — instead assert
 * the module source contract and OfflineBanner/SessionOfflineBanner patterns.
 *
 *   npx tsx scripts/_test-online-status-hydration-unit.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, label: string, detail?: string) {
  if (!condition) {
    console.error("FAIL:", label, detail ?? "");
    process.exitCode = 1;
    return;
  }
  console.log("OK:", label);
}

const hookSrc = readFileSync(
  resolve("hooks/use-online-status.ts"),
  "utf8",
);
const bannerSrc = readFileSync(
  resolve("components/session-offline-banner.tsx"),
  "utf8",
);
const queueSrc = readFileSync(
  resolve("components/offline-write-queue-indicator.tsx"),
  "utf8",
);

assert(
  /useState\(true\)/.test(hookSrc),
  "useOnlineStatus initial state is always true (SSR-safe)",
);
assert(
  !/typeof navigator === ["']undefined["'] \? true : navigator\.onLine/.test(
    hookSrc,
  ),
  "useOnlineStatus does not read navigator.onLine during useState init",
);
assert(
  /setIsOnline\(navigator\.onLine\)/.test(hookSrc),
  "useOnlineStatus syncs navigator.onLine inside useEffect",
);

assert(
  /mounted && !isOnline/.test(bannerSrc) ||
    /show=\{mounted && !isOnline\}/.test(bannerSrc),
  "SessionOfflineBanner gates show on mounted && !isOnline",
);
assert(
  !/show=\{!isOnline\}/.test(bannerSrc),
  "SessionOfflineBanner no longer shows={!isOnline} alone",
);

assert(
  /useOnlineStatus\(\)/.test(queueSrc),
  "OfflineWriteQueueIndicator uses useOnlineStatus (not navigator.onLine)",
);
assert(
  !/disabled=\{[^}]*navigator\.onLine/.test(queueSrc),
  "OfflineWriteQueueIndicator does not disable from navigator.onLine in JSX",
);

if (process.exitCode) {
  console.error("\nHydration online-status unit checks FAILED");
  process.exit(1);
}
console.log("\nAll online-status hydration unit checks passed.");
