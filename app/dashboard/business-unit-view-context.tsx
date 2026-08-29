"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  STAMP_REFUSED_VIEW_ALL_MESSAGE,
  resolveStampBusinessUnitId,
} from "@/utils/business-unit-view";

type BusinessUnitViewValue = {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
  workspaceName: string | null;
};

const BusinessUnitViewContext = createContext<BusinessUnitViewValue>({
  viewAllBusinessUnits: false,
  activeBusinessUnitId: null,
  workspaceName: null,
});

export function BusinessUnitViewProvider({
  children,
  viewAllBusinessUnits,
  activeBusinessUnitId,
  workspaceName,
}: BusinessUnitViewValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      viewAllBusinessUnits,
      activeBusinessUnitId,
      workspaceName,
    }),
    [viewAllBusinessUnits, activeBusinessUnitId, workspaceName],
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
