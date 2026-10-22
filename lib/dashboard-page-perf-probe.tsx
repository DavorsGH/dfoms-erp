import {
  formatLayoutPerfMetaContent,
  getSupabaseHttpPerfPageSnapshot,
  getSupabaseHttpPerfSnapshot,
} from "@/lib/supabase-http-perf";
import { isPerfProbeEnabled } from "@/utils/perf-probe";

export function readSupabasePerfCallIndex(): number {
  return getSupabaseHttpPerfSnapshot()?.callCount ?? 0;
}

export function getDashboardPagePerfMetaContent(
  renderStartedAt: number,
  supabaseCallsBefore: number,
): string | null {
  if (!isPerfProbeEnabled()) {
    return null;
  }
  const snapshot = getSupabaseHttpPerfPageSnapshot(supabaseCallsBefore);
  if (!snapshot) {
    return null;
  }
  return formatLayoutPerfMetaContent({
    renderMs: Date.now() - renderStartedAt,
    snapshot,
  });
}

export function DashboardPagePerfMeta({
  renderStartedAt,
  supabaseCallsBefore,
}: {
  renderStartedAt: number;
  supabaseCallsBefore: number;
}) {
  const content = getDashboardPagePerfMetaContent(
    renderStartedAt,
    supabaseCallsBefore,
  );
  if (!content) {
    return null;
  }
  return <meta name="dfoms-perf-page" content={content} />;
}
