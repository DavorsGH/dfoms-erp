"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import DashboardButton from "@/components/dashboard-button";
import TimePickerField from "@/components/time-picker-field";
import { useAlert, useConfirm, useToast } from "@/components/feedback/feedback-context";
import { inputClassName } from "../employees/employee-record-utils";
import type {
  SimulatorResultCard,
  SimulatorScenarioId,
} from "@/lib/adms/scanner-simulator-traffic";
import { mondayOf, weekIsPast } from "@/lib/adms/scanner-simulator-traffic";

type SimulatorEmployee = {
  staffId: string;
  fullName: string;
  pin: string;
};

type ScannerSimulatorPanelProps = {
  deviceId: string;
  deviceLabel: string;
  serialNumber: string;
  onClose: () => void;
};

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ResultCardView({ card }: { card: SimulatorResultCard }) {
  const kind = card.resultKind ?? "graded";
  const frame =
    kind === "error"
      ? "border-red-200 bg-red-50"
      : kind === "summary"
        ? "border-slate-200 bg-white"
        : card.pass
          ? "border-emerald-200 bg-emerald-50"
          : "border-amber-200 bg-amber-50";
  return (
    <article className={`rounded-lg border p-4 ${frame}`}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-medium text-[#0f2744]">{card.title}</h4>
        {kind === "graded" ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              card.pass ? "bg-emerald-600 text-white" : "bg-amber-700 text-white"
            }`}
          >
            {card.pass ? "PASS" : "FAIL"}
          </span>
        ) : kind === "error" ? (
          <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-medium text-white">
            Error
          </span>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700 sm:grid-cols-3">
        <div>Lines sent: {card.linesSent}</div>
        <div>Accepted: {card.accepted}</div>
        <div>Duplicates skipped: {card.duplicatesSkipped}</div>
        <div>Needs review: {card.needsReview}</div>
        <div>Attendance created: {card.attendanceCreated}</div>
        <div>Attendance updated: {card.attendanceUpdated}</div>
      </dl>
      {card.attendance ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-800 sm:grid-cols-3">
          <div>Date: {card.attendance.date}</div>
          <div>Clock in: {card.attendance.clockIn}</div>
          <div>Clock out: {card.attendance.clockOut}</div>
          <div>
            Hours: {card.attendance.hours === "—" ? "—" : `${card.attendance.hours} h`}
          </div>
          <div>Status: {card.attendance.status}</div>
          <div>Exception: {card.attendance.exception}</div>
        </dl>
      ) : kind === "summary" ? (
        <p className="mt-3 text-sm text-slate-600">No attendance row for this punch.</p>
      ) : null}
      {card.notes.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {card.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {card.reasons.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-amber-950">
          {card.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {card.links.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {card.links.map((link) => (
            <li key={`${link.href}-${link.label}`}>
              <Link href={link.href} className="text-[#0f2744] underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default function ScannerSimulatorPanel({
  deviceId,
  deviceLabel,
  serialNumber,
  onClose,
}: ScannerSimulatorPanelProps) {
  const { toast } = useToast();
  const { alertError } = useAlert();
  const confirm = useConfirm();
  const [employees, setEmployees] = useState<SimulatorEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [busy, setBusy] = useState(false);
  const [weekStart, setWeekStart] = useState("");
  const [pin, setPin] = useState("");
  /** null follows the Past week date until the cashier picks a punch date. */
  const [punchDate, setPunchDate] = useState<string | null>(null);
  const [punchTime, setPunchTime] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [cards, setCards] = useState<SimulatorResultCard[]>([]);
  const [replayBody, setReplayBody] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingEmployees(true);
      try {
        const response = await fetch(
          `/api/attendance/scanner-simulator?deviceId=${encodeURIComponent(deviceId)}`,
        );
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          employees?: SimulatorEmployee[];
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load employees for this device.");
        }
        if (!cancelled) {
          const rows = payload?.employees ?? [];
          setEmployees(rows);
          setPin(rows[0]?.pin ?? "");
        }
      } catch (error) {
        if (!cancelled) {
          setLoadingEmployees(false);
          void alertError(error, { title: "Could not open the simulator" });
        }
        return;
      }
      if (!cancelled) {
        setLoadingEmployees(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  function requirePastWeek(): string | null {
    if (!weekStart || !weekIsPast(mondayOf(weekStart), todayIso())) {
      void alertError("Choose a week that has already ended.", {
        title: "Scanner simulator",
      });
      return null;
    }
    return mondayOf(weekStart);
  }

  async function postSimulator(body: Record<string, unknown>, title: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/attendance/scanner-simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, ...body }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        card?: SimulatorResultCard;
        cards?: SimulatorResultCard[];
        punchesDeleted?: number;
        attendanceRowsDeleted?: number;
        mixedRowsKept?: number;
      } | null;
      if (!response.ok) {
        setBusy(false);
        void alertError(payload?.error || "Scanner simulator failed.", { title });
        return;
      }
      if (payload?.card) {
        setCards((current) => [payload.card!, ...current]);
        if (payload.card.replayBody) {
          setReplayBody(payload.card.replayBody);
        }
        const kind = payload.card.resultKind ?? "graded";
        toast(
          kind === "summary"
            ? `${payload.card.title} recorded`
            : kind === "error"
              ? `${payload.card.title} — error`
              : `${payload.card.title} — ${payload.card.pass ? "PASS" : "FAIL"}`,
        );
      }
      if (payload?.cards) {
        setCards(payload.cards);
        const batch = payload.cards.find((card) => card.scenario === "offline_batch");
        if (batch?.replayBody) {
          setReplayBody(batch.replayBody);
        }
        const failed = payload.cards.filter(
          (card) =>
            (card.resultKind ?? "graded") === "graded"
              ? !card.pass
              : card.resultKind === "error",
        ).length;
        toast(
          failed === 0
            ? "All scanner scenarios passed"
            : `Scanner scenarios finished — ${failed} failed`,
        );
      }
      if (typeof payload?.punchesDeleted === "number") {
        toast(
          `Simulated data removed — ${payload.punchesDeleted} punches, ${payload.attendanceRowsDeleted ?? 0} attendance rows`,
        );
      }
      setBusy(false);
    } catch (error) {
      setBusy(false);
      void alertError(error, { title });
    }
  }

  function submitSinglePunch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const pinField = form.elements.namedItem("single-punch-pin");
    const dateField = form.elements.namedItem("single-punch-date");
    const timeField = form.elements.namedItem("single-punch-time");
    if (pinField instanceof HTMLSelectElement) {
      pinField.setCustomValidity(pin.trim() ? "" : "Choose an employee.");
      if (!pin.trim()) {
        pinField.reportValidity();
        return;
      }
    }
    if (timeField instanceof HTMLInputElement) {
      timeField.setCustomValidity(punchTime ? "" : "Choose a time.");
      if (!punchTime) {
        timeField.reportValidity();
        return;
      }
    }
    if (dateField instanceof HTMLInputElement) {
      dateField.setCustomValidity(dateField.value ? "" : "Choose a date.");
      if (!dateField.value) {
        dateField.reportValidity();
        return;
      }
    }
    const day = dateField instanceof HTMLInputElement ? dateField.value : "";
    void postSimulator(
      {
        action: "run",
        scenario: "single_punch",
        pin,
        localDateTime: `${day} ${punchTime}`,
        direction,
      },
      "Single punch",
    );
  }

  async function runScenario(scenario: SimulatorScenarioId) {
    if (scenario === "resend_batch") {
      if (!replayBody) {
        void alertError("Run the offline batch first, then re-send it.", {
          title: "Re-send",
        });
        return;
      }
      await postSimulator(
        { action: "run", scenario, replayBody, weekStart },
        "Re-send",
      );
      return;
    }
    if (scenario !== "heartbeat" && scenario !== "non_attlog") {
      const week = requirePastWeek();
      if (!week) {
        return;
      }
      await postSimulator({ action: "run", scenario, weekStart: week }, scenario);
      return;
    }
    await postSimulator({ action: "run", scenario, weekStart }, scenario);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">Simulate scanner</h3>
            <p className="mt-1 text-sm text-slate-600">
              {deviceLabel} · <span className="font-mono">{serialNumber}</span>
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Sends ZKTeco ADMS traffic for this serial through /iclock. Staging and
              development only.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Close
          </button>
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Past week
          <input
            type="date"
            value={weekStart}
            onChange={(event) => setWeekStart(event.target.value)}
            className={`${inputClassName} mt-1`}
          />
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Run all uses this week so punches are already in the past.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <DashboardButton
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => {
              const week = requirePastWeek();
              if (!week) {
                return;
              }
              void postSimulator({ action: "run_all", weekStart: week }, "Run all scenarios");
            }}
          >
            {busy ? "Running…" : "Run all scenarios"}
          </DashboardButton>
          <DashboardButton
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                const confirmed = await confirm({
                  title: "Clean up simulated data",
                  message:
                    "Delete punches this simulator created on this device, including unknown-PIN punches (900000001…) and their Needs review items? Attendance rows that contain only those punches are removed. Other attendance is left as it is.",
                  confirmLabel: "Delete simulated data",
                  destructive: true,
                });
                if (!confirmed) {
                  return;
                }
                await postSimulator({ action: "cleanup" }, "Clean up simulated data");
              })();
            }}
          >
            Clean up simulated data
          </DashboardButton>
        </div>

        <form
          className="mt-6 rounded-lg border border-slate-200 p-4"
          onSubmit={submitSinglePunch}
        >
          <h4 className="font-medium text-[#0f2744]">Single punch</h4>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Employee
            <select
              name="single-punch-pin"
              value={pin}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setPin(event.target.value);
              }}
              className={`${inputClassName} mt-1`}
              disabled={loadingEmployees}
            >
              {employees.length === 0 ? (
                <option value="">No mapped employees</option>
              ) : null}
              {employees.map((employee) => (
                <option key={employee.pin} value={employee.pin}>
                  {employee.fullName} ({employee.staffId}) · PIN {employee.pin}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Date
            <input
              name="single-punch-date"
              type="date"
              value={punchDate ?? weekStart}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setPunchDate(event.target.value);
              }}
              className={`${inputClassName} mt-1`}
            />
          </label>
          <div className="mt-3">
            <p className="mb-1 text-sm font-medium text-slate-700">Time</p>
            <TimePickerField
              name="single-punch-time"
              aria-label="Time"
              value={punchTime}
              disabled={busy}
              onChange={setPunchTime}
            />
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Direction
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value === "out" ? "out" : "in")}
              className={`${inputClassName} mt-1`}
            >
              <option value="in">In</option>
              <option value="out">Out</option>
            </select>
          </label>
          <DashboardButton
            type="submit"
            className="mt-3"
            variant="secondary"
            disabled={busy}
          >
            Send punch
          </DashboardButton>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["staff_group_day", "Day for a staff group"],
              ["offline_batch", "Offline batch"],
              ["resend_batch", "Re-send"],
              ["clock_drift", "Clock drift"],
              ["wrong_timezone", "Wrong time zone"],
              ["unknown_pin", "Unknown PIN"],
              ["non_attlog", "OPERLOG / USERINFO"],
              ["heartbeat", "Heartbeat burst"],
            ] as const
          ).map(([scenario, label]) => (
            <button
              key={scenario}
              type="button"
              disabled={busy}
              onClick={() => void runScenario(scenario)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-[#0f2744] hover:bg-slate-50 disabled:text-slate-400"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          {cards.map((card, index) => (
            <ResultCardView key={`${card.scenario}-${index}`} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
