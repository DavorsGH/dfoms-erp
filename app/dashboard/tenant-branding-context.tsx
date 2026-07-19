"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_TENANT_BRANDING,
  type TenantBranding,
} from "@/utils/tenant-branding-types";

const TenantBrandingContext = createContext<TenantBranding>(DEFAULT_TENANT_BRANDING);

type TenantBrandingProviderProps = {
  branding: TenantBranding;
  children: ReactNode;
};

export function TenantBrandingProvider({
  branding,
  children,
}: TenantBrandingProviderProps) {
  return (
    <TenantBrandingContext.Provider value={branding}>
      {children}
    </TenantBrandingContext.Provider>
  );
}

export function useTenantBranding(): TenantBranding {
  return useContext(TenantBrandingContext);
}
