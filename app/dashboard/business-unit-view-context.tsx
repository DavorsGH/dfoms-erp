"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BusinessUnitSwitcherOption } from "./business-unit-switcher";
import {
  STAMP_REFUSED_VIEW_ALL_MESSAGE,
  resolveBusinessUnitReadScope,
  resolveStampBusinessUnitId,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

type BusinessUnitViewValue = {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
  workspaceName: string | null;
  units: BusinessUnitSwitcherOption[];
};

const BusinessUnitViewContext = createContext<BusinessUnitViewValue>({
  viewAllBusinessUnits: false,
  activeBusinessUnitId: null,
  workspaceName: null,
  units: [],
});

export function BusinessUnitViewProvider({
  children,
  viewAllBusinessUnits,
  activeBusinessUnitId,
  workspaceName,
  units = [],
}: BusinessUnitViewValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      viewAllBusinessUnits,
      activeBusinessUnitId,
      workspaceName,
      units,
    }),
    [viewAllBusinessUnits, activeBusinessUnitId, workspaceName, units],
  );
  return (
    <BusinessUnitViewContext.Provider value={value}>
      {children}
    </BusinessUnitViewContext.Provider>
  );
}

export function useBusinessUnitView(): BusinessUnitViewValue {
  return useContext(BusinessUnitViewContext);
}

/**
 * Resolve stamp id for client creates, or an error when All Businesses is selected.
 */
export function useStampBusinessUnitId():
  | { ok: true; businessUnitId: string | null }
  | { ok: false; error: typeof STAMP_REFUSED_VIEW_ALL_MESSAGE } {
  const { viewAllBusinessUnits, activeBusinessUnitId } = useBusinessUnitView();
  return resolveStampBusinessUnitId({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
}

/**
 * Resolve list/read scope for the current switcher selection.
 * Pair with applyBusinessUnitScope on queries that have business_unit_id.
 */
export function useBusinessUnitReadScope(): BusinessUnitReadScope {
  const { viewAllBusinessUnits, activeBusinessUnitId } = useBusinessUnitView();
  return useMemo(
    () =>
      resolveBusinessUnitReadScope({
        viewAllBusinessUnits,
        activeBusinessUnitId,
      }),
    [viewAllBusinessUnits, activeBusinessUnitId],
  );
}
