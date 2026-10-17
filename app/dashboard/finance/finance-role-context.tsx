"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "@/app/dashboard/user-account-types";

const FinanceRoleContext = createContext<AppRole | null>(null);

export function FinanceRoleProvider({
  role,
  children,
}: {
  role: AppRole | null;
  children: React.ReactNode;
}) {
  return (
    <FinanceRoleContext.Provider value={role}>{children}</FinanceRoleContext.Provider>
  );
}

export function useFinanceRole(): AppRole | null {
  return useContext(FinanceRoleContext);
}
