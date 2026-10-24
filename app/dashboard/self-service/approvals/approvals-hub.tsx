"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";
import AttendanceApprovals from "@/app/dashboard/attendance-approvals/attendance-approvals";
import LeaveApprovals from "@/app/dashboard/leave-approvals/leave-approvals";
import type { LeaveRequest } from "@/app/dashboard/self-service/leave-request-utils";
import { createClient } from "@/utils/supabase/client";
import { ATTENDANCE_APPROVALS_CHANGED } from "@/app/dashboard/attendance-approvals/attendance-approvals-count-badge";

export const SELF_SERVICE_APPROVALS_HREF = "/dashboard/self-service/approvals";

export type ApprovalsTab = "leave" | "attendance";

function CountBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-[#0f2744]">
      {count > 99 ? "99+" : count}
    </span>
  );
}

type ApprovalsHubProps = {
  showLeaveTab: boolean;
  showAttendanceTab: boolean;
  initialTab: ApprovalsTab;
  leaveApproverAuthUid: string | null;
  leaveTenantId: string | null;
  leaveEmployeeNames: Record<string, string>;
  leaveInitialRequests: LeaveRequest[];
  leaveFetchError: string | null;
};

export default function ApprovalsHub({
  showLeaveTab,
  showAttendanceTab,
  initialTab,
  leaveApproverAuthUid,
  leaveTenantId,
  leaveEmployeeNames,
  leaveInitialRequests,
  leaveFetchError,
}: ApprovalsHubProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  const activeTab: ApprovalsTab = useMemo(() => {
    if (tabParam === "attendance" && showAttendanceTab) {
      return "attendance";
    }
    if (tabParam === "leave" && showLeaveTab) {
      return "leave";
    }
    if (initialTab === "attendance" && showAttendanceTab) {
      return "attendance";
    }
    if (showLeaveTab) {
      return "leave";
    }
    return "attendance";
  }, [tabParam, showAttendanceTab, showLeaveTab, initialTab]);

  const [leaveCount, setLeaveCount] = useState(leaveInitialRequests.length);
  const [attendanceCount, setAttendanceCount] = useState(0);

  const refreshLeaveCount = useCallback(async () => {
    if (!showLeaveTab || !leaveApproverAuthUid) {
      setLeaveCount(0);
      return;
    }
    const supabase = createClient();
    const { count } = await supabase
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "Pending")
      .eq("approver_user_account_id", leaveApproverAuthUid);
    setLeaveCount(count ?? 0);
  }, [showLeaveTab, leaveApproverAuthUid]);

  const refreshAttendanceCount = useCallback(async () => {
    if (!showAttendanceTab) {
      setAttendanceCount(0);
      return;
    }
    try {
      const response = await fetch("/api/attendance/approvals?countOnly=1");
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { count?: number };
      setAttendanceCount(body.count ?? 0);
    } catch {
      // Keep last known count.
    }
  }, [showAttendanceTab]);

  useEffect(() => {
    void refreshLeaveCount();
    void refreshAttendanceCount();
    const onFocus = () => {
      void refreshLeaveCount();
      void refreshAttendanceCount();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(ATTENDANCE_APPROVALS_CHANGED, onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ATTENDANCE_APPROVALS_CHANGED, onFocus);
    };
  }, [refreshLeaveCount, refreshAttendanceCount]);

  function setTab(next: ApprovalsTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const tabs: { id: ApprovalsTab; label: string; count: number; show: boolean }[] =
    [
      {
        id: "leave",
        label: "Leave",
        count: leaveCount,
        show: showLeaveTab,
      },
      {
        id: "attendance",
        label: "Attendance",
        count: attendanceCount,
        show: showAttendanceTab,
      },
    ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Approvals</h1>
      <nav className="mb-6 border-b border-slate-200 pb-4">
        <ModuleNavTabStrip scrollKey={`${pathname}?${activeTab}`}>
          {tabs
            .filter((tab) => tab.show)
            .map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  {...moduleNavActiveTabProps(active)}
                  onClick={() => setTab(tab.id)}
                  className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[#0f2744] text-white"
                      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                  <CountBadge count={tab.count} />
                </button>
              );
            })}
        </ModuleNavTabStrip>
      </nav>

      {activeTab === "leave" && showLeaveTab ? (
        <div>
          <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
            Pending Leave Requests
          </h2>
          <LeaveApprovals
            approverAuthUid={leaveApproverAuthUid}
            tenantId={leaveTenantId}
            initialEmployeeNames={leaveEmployeeNames}
            initialRequests={leaveInitialRequests}
            fetchError={leaveFetchError}
          />
        </div>
      ) : null}

      {activeTab === "attendance" && showAttendanceTab ? (
        <div>
          <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
            Attendance Approvals
          </h2>
          <AttendanceApprovals />
        </div>
      ) : null}

      {!showLeaveTab && !showAttendanceTab ? (
        <p className="text-sm text-slate-600">
          You do not have any approval inboxes.{" "}
          <Link href="/dashboard/self-service" className="underline">
            Back to Self-Service
          </Link>
        </p>
      ) : null}
    </div>
  );
}
