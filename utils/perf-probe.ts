/** Shared perf counters for middleware / layout probes (Edge + Node safe). */

export type PerfProbeSnapshot = {
  startedAtMs: number;
  authCalls: number;
  dbCalls: number;
  skippedAuthCalls: number;
  skippedDbCalls: number;
};

export function createPerfProbe(): PerfProbeSnapshot & {
  countAuth: (n?: number) => void;
  countDb: (n?: number) => void;
  countSkippedAuth: (n?: number) => void;
  countSkippedDb: (n?: number) => void;
  elapsedMs: () => number;
  toHeaderValues: () => Record<string, string>;
} {
  const probe: PerfProbeSnapshot = {
    startedAtMs: Date.now(),
    authCalls: 0,
    dbCalls: 0,
    skippedAuthCalls: 0,
    skippedDbCalls: 0,
  };

  return {
    ...probe,
    countAuth(n = 1) {
      probe.authCalls += n;
    },
    countDb(n = 1) {
      probe.dbCalls += n;
    },
    countSkippedAuth(n = 1) {
      probe.skippedAuthCalls += n;
    },
    countSkippedDb(n = 1) {
      probe.skippedDbCalls += n;
    },
    elapsedMs() {
      return Date.now() - probe.startedAtMs;
    },
    toHeaderValues() {
      const elapsed = Date.now() - probe.startedAtMs;
      return {
        "x-dfoms-perf-middleware-ms": String(elapsed),
        "x-dfoms-perf-middleware-auth-calls": String(probe.authCalls),
        "x-dfoms-perf-middleware-db-calls": String(probe.dbCalls),
        "x-dfoms-perf-middleware-skipped-auth": String(probe.skippedAuthCalls),
        "x-dfoms-perf-middleware-skipped-db": String(probe.skippedDbCalls),
      };
    },
  };
}

export function isPerfProbeEnabled(): boolean {
  return process.env.DFOMS_PERF_PROBE === "true";
}
