"use client";

import { createContext, useContext } from "react";

const OperationsReadOnlyContext = createContext(false);

export function OperationsReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <OperationsReadOnlyContext.Provider value={readOnly}>
      {children}
    </OperationsReadOnlyContext.Provider>
  );
}

export function useOperationsReadOnly(): boolean {
  return useContext(OperationsReadOnlyContext);
}
