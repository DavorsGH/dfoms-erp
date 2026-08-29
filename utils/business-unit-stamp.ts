import "server-only";

import { getActiveBusinessUnitId } from "@/utils/dashboard-auth";

export type CreateBusinessUnitStampOptions = {
  /**
   * When the key is present (including null), use it as the stamp.
   * When omitted, resolve via getActiveBusinessUnitId() unless useActiveContext is false.
   */
  businessUnitId?: string | null;
  /** Default true. Set false for system/webhook paths with no staff switcher. */
  useActiveContext?: boolean;
};

/**
 * Resolve business_unit_id for a new row: explicit override, active switcher, or null.
 */
export async function resolveCreateBusinessUnitId(
  options?: CreateBusinessUnitStampOptions,
): Promise<string | null> {
  if (options && Object.prototype.hasOwnProperty.call(options, "businessUnitId")) {
    const value = options.businessUnitId;
    if (value == null) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed || null;
  }

  if (options?.useActiveContext === false) {
    return null;
  }

  return getActiveBusinessUnitId();
}
