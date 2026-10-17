import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";

export const DIVIDENDS_READ_ROLES = ["director", "super_admin"] as const;

export const DIVIDENDS_WRITE_ROLES = ["director", "super_admin"] as const;

const VIEW_ALL_DIVIDENDS_MESSAGE =
  "Select the business unit that is paying this dividend (All businesses is not allowed).";

const CHOOSE_BUSINESS_UNIT_MESSAGE =
  "Choose a business unit in the header before continuing.";

export async function requireDividendsRead() {
  return requireTenantRoleIn(DIVIDENDS_READ_ROLES);
}

export async function requireDividendsWrite() {
  return requireTenantRoleIn(DIVIDENDS_WRITE_ROLES);
}

/**
 * Active header business unit for dividends (validated tenant + allowed units).
 * Never read business_unit_id from the client for scoping.
 */
export async function requireDividendsScopedBusinessUnit(): Promise<
  | { ok: true; businessUnitId: string }
  | { ok: false; response: NextResponse }
> {
  const viewAll = await getViewAllBusinessUnits();
  if (viewAll) {
    return {
      ok: false,
      response: NextResponse.json({ error: VIEW_ALL_DIVIDENDS_MESSAGE }, { status: 400 }),
    };
  }

  const businessUnitId = await getActiveBusinessUnitId();
  if (!businessUnitId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: CHOOSE_BUSINESS_UNIT_MESSAGE },
        { status: 400 },
      ),
    };
  }

  return { ok: true, businessUnitId };
}

export function dividendDeclarationMatchesActiveBusinessUnit(
  declarationBusinessUnitId: string,
  activeBusinessUnitId: string,
): boolean {
  return declarationBusinessUnitId === activeBusinessUnitId;
}
