"use client";

import { useCallback, useState } from "react";
import {
  executeClientPlatformSignOut,
  type PlatformSignOutLoginPath,
} from "@/lib/auth/client-sign-out-flow";

type UsePlatformSignOutOptions = {
  loginPath: PlatformSignOutLoginPath;
  /** e.g. dismiss Paystack overlays on staff dashboard. */
  beforeSignOut?: () => void;
};

export function usePlatformSignOut({
  loginPath,
  beforeSignOut,
}: UsePlatformSignOutOptions) {
  const [loggingOut, setLoggingOut] = useState(false);

  const signOut = useCallback(async () => {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    beforeSignOut?.();

    try {
      await executeClientPlatformSignOut(loginPath);
    } catch (error) {
      console.error("[sign-out] failed:", error);
      setLoggingOut(false);
    }
  }, [beforeSignOut, loggingOut, loginPath]);

  return { signOut, loggingOut };
}
