"use client";

import type { ReactNode } from "react";
import { FeedbackProvider } from "./feedback-provider";

export function FeedbackShell({ children }: { children: ReactNode }) {
  return <FeedbackProvider>{children}</FeedbackProvider>;
}
