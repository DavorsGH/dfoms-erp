"use client";

import Tooltip from "@/components/ui/tooltip";
import type { DutyRosterShiftHeader } from "./duty-roster-utils";

const OLD_SETTING_TOOLTIP =
  "Set this shift's real times in Administration → Roster & Shift Settings → Shift times";

type DutyRosterShiftHeaderLinesProps = {
  header: DutyRosterShiftHeader;
  variant?: "screen" | "print" | "detail";
};

export default function DutyRosterShiftHeaderLines({
  header,
  variant = "screen",
}: DutyRosterShiftHeaderLinesProps) {
  const onNavy = variant === "screen";
  const primaryClass = onNavy
    ? "mt-1 block text-[13px] font-medium text-white/90"
    : "block text-[13px] font-medium text-slate-900";
  const weekendClass = onNavy
    ? "mt-0.5 block text-[12px] font-medium text-white/75"
    : "mt-0.5 block text-[12px] font-medium text-slate-600";

  return (
    <>
      <span className={primaryClass}>{header.primary}</span>
      {header.weekend ? <span className={weekendClass}>{header.weekend}</span> : null}
      {header.legacy ? (
        <Tooltip content={OLD_SETTING_TOOLTIP}>
          <span
            tabIndex={0}
            className="mt-1 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-950"
          >
            (old setting)
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}
