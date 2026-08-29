import "server-only";

import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  STAMP_REFUSED_VIEW_ALL_MESSAGE,
  resolveStampBusinessUnitId,
} from "@/utils/business-unit-view";

export type CreateBusinessUnitStampOptions = {
  /**
   * When the key is present (including null), use it as the stamp
   * (still refused when the user is on All Businesses aggregate view,
   * unless useActiveContext is false).
   */
  businessUnitId?: string | null;
  /** Default true. Set false for system/webhook paths with no staff switcher. */
  useActiveContext?: boolean;
};

export class StampRefusedViewAllError extends Error {
  readonly code = "STAMP_REFUSED_VIEW_ALL" as const;
  constructor(message: string = STAMP_REFUSED_VIEW_ALL_MESSAGE) {
    super(message);
    this.name = "StampRefusedViewAllError";
  }
}

/**
 * Resolve business_unit_id for a new row: explicit override, active switcher, or null.
 * Refuses when the staff switcher is on All Businesses (aggregate is not a stamp target).
 */
export async function resolveCreateBusinessUnitId(
  options?: CreateBusinessUnitStampOptions,
): Promise<string | null> {
  const useActiveContext = options?.useActiveContext !== false;

  if (useActiveContext) {
    const viewAll = await getViewAllBusinessUnits();
    if (viewAll) {
      throw new StampRefusedViewAllError();
    }
  }

  if (options && Object.prototype.hasOwnProperty.call(options, "businessUnitId")) {
    const value = options.businessUnitId;
    if (value == null) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed || null;
  }

  if (!useActiveContext) {
    return null;
  }

  return getActiveBusinessUnitId();
}

/**
 * Sync helper for callers that already loaded view + active id (e.g. RSC → client props).
 */
export function stampBusinessUnitIdOrThrow(args: {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
}): string | null {
  const result = resolveStampBusinessUnitId(args);
  if (!result.ok) {
    throw new StampRefusedViewAllError(result.error);
  }
  return result.businessUnitId;
}
