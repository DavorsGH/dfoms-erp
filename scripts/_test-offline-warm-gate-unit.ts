/**
 * Unit checks for offline warm session gating (no browser).
 *   npx tsx scripts/_test-offline-warm-gate-unit.ts
 */
import {
  buildOfflineWarmSessionKey,
  hasOfflineRouteWarmCompleted,
  markOfflineRouteWarmCompleted,
  OFFLINE_ROUTE_WARM_STORAGE_PREFIX,
  stableAvatarWarmKey,
} from "../lib/offline-nav-warm";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`[PASS] ${name}${detail ? `: ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`[FAIL] ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const sessionKey = buildOfflineWarmSessionKey(
  "00000001-0000-4000-8000-000000000001",
  "auth-uid-123",
);

// jsdom-like sessionStorage shim for Node
const store = new Map<string, string>();
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

assert(
  "warm not complete initially",
  !hasOfflineRouteWarmCompleted(sessionKey),
);
markOfflineRouteWarmCompleted(sessionKey);
assert(
  "warm complete after mark",
  hasOfflineRouteWarmCompleted(sessionKey),
);
assert(
  "sessionStorage key format",
  store.has(`${OFFLINE_ROUTE_WARM_STORAGE_PREFIX}:${sessionKey}`),
);

assert(
  "avatar key strips signed query",
  stableAvatarWarmKey(
    "https://example.supabase.co/storage/v1/object/public/photos/a.jpg?token=abc",
  ) === "https://example.supabase.co/storage/v1/object/public/photos/a.jpg",
);

assert(
  "avatar key stable across token rotation",
  stableAvatarWarmKey("https://x/y.png?token=1") ===
    stableAvatarWarmKey("https://x/y.png?token=2"),
);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exitCode = 1;
}
