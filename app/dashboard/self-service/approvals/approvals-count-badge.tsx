"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { ATTENDANCE_APPROVALS_CHANGED } from "@/app/dashboard/attendance-approvals/attendance-approvals-count-badge";

type ApprovalsCountBadgeProps = {
  showLeave: boolean;
  showAttendance: boolean;
};

export default function ApprovalsCountBadge({
  showLeave,
  showAttendance,
}: ApprovalsCountBadgeProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let total = 0;
      try {
        if (showLeave) {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            const { count: leaveCount } = await supabase
              .from("leave_requests")
              .select("id", { count: "exact", head: true })
              .eq("status", "Pending")
              .eq("approver_user_account_id", user.id);
            total += leaveCount ?? 0;
          }
        }
        if (showAttendance) {
          const response = await fetch("/api/attendance/approvals?countOnly=1");
          if (response.ok) {
            const body = (await response.json()) as { count?: number };
            total += body.count ?? 0;
          }
        }
      } catch {
        // Keep last known count.
      }
      if (!cancelled) {
        setCount(total);
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
  }, [showLeave, showAttendance]);

  if (count <= 0) {
    return null;
  }

  return (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-[#0f2744]">
      {count > 99 ? "99+" : count}
    </span>
  );
}
