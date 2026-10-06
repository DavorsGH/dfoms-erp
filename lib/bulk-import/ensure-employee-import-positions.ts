import type { Client } from "pg";
import { normalizeTenantLookupKey } from "@/lib/bulk-import/tenant-name-lookup";
import {
  resolvePositionTitleForCommit,
  type PositionTitleResolverCache,
} from "@/lib/bulk-import/resolve-employee-for-commit";

export async function ensureMissingPositionsForEmployeeImport(input: {
  client: Client;
  tenantId: string;
  rows: Array<{ mapped_data: Record<string, unknown> }>;
  cache: PositionTitleResolverCache;
  /** Titles inserted during this pass (for finish-screen summary). */
  createdTitles?: string[];
}): Promise<void> {
  const titlesByKey = new Map<string, string>();

  for (const row of input.rows) {
    const raw = String(row.mapped_data.position_title ?? "").trim();
    if (!raw) {
      continue;
    }

    const key = normalizeTenantLookupKey(raw);
    if (!titlesByKey.has(key)) {
      titlesByKey.set(key, raw);
    }
  }

  for (const title of titlesByKey.values()) {
    await resolvePositionTitleForCommit({
      client: input.client,
      tenantId: input.tenantId,
      positionTitle: title,
      cache: input.cache,
      createIfMissing: true,
      onCreated: input.createdTitles
        ? (createdTitle) => {
            input.createdTitles!.push(createdTitle);
          }
        : undefined,
    });
  }
}
