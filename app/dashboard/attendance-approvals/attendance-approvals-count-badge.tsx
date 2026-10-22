"use client";

import { useEffect, useState } from "react";

export const ATTENDANCE_APPROVALS_CHANGED = "attendance-approvals-changed";

export function notifyAttendanceApprovalsChanged() {
  window.dispatchEvent(new Event(ATTENDANCE_APPROVALS_CHANGED));
}

export default function AttendanceApprovalsCountBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/attendance/approvals?countOnly=1");
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { count?: number };
        if (!cancelled) {
          setCount(body.count ?? 0);
        }
      } catch {
        // Badge stays at the last known count.
      }
    }

    void load();
    window.addEventListener("focus", load);
    window.addEventListener(ATTENDANCE_APPROVALS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
      window.removeEventListener(ATTENDANCE_APPROVALS_CHANGED, load);
    };
  }, []);

  if (count <= 0) {
    return null;
  }

  return (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-[#0f2744]">
      {count > 99 ? "99+" : count}
    </span>
  );
}
