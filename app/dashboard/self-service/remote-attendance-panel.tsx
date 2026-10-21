"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { inputClassName } from "../employees/employee-record-utils";
import DashboardButton from "@/components/dashboard-button";
import TimePickerField from "@/components/time-picker-field";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import {
  pastDayFieldIssues,
  preselectRemoteLocation,
  recentCustomLocations,
  REMOTE_LOCATION_OPTIONS,
  REMOTE_LOCATION_OTHER,
  remoteNoteIssues,
  addCalendarDays,
  todayInAccra,
  type RemoteFieldIssue,
} from "@/lib/attendance-requests/rules";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type RemoteRequest = {
  id: string;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  location_note: string | null;
  reason: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
};

type GeoFields = {
  latitude: number;
  longitude: number;
  location_accuracy_m: number;
};

function formatWhen(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const day = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Accra",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Accra",
  });
  return `${day} · ${time}`;
}

function formatClock(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Accra",
  });
}

async function readGeo(): Promise<GeoFields | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return null;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          location_accuracy_m: position.coords.accuracy,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

function LocationFields({
  scope,
  locationRef,
  otherRef,
  reasonRef,
  locationChoice,
  otherLocation,
  reason,
  recentLocations,
  onLocation,
  onOther,
  onReason,
}: {
  scope: "today" | "past";
  locationRef?: RefObject<HTMLSelectElement | null>;
  otherRef?: RefObject<HTMLInputElement | null>;
  reasonRef?: RefObject<HTMLInputElement | null>;
  locationChoice: string;
  otherLocation: string;
  reason: string;
  recentLocations: string[];
  onLocation: (value: string) => void;
  onOther: (value: string) => void;
  onReason: (value: string) => void;
}) {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Location</span>
        <select
          id={`${scope}_location`}
          ref={locationRef}
          name="location_note"
          className={inputClassName}
          value={locationChoice}
          onChange={(event) => {
            event.target.setCustomValidity("");
            onLocation(event.target.value);
          }}
        >
          <option value="">Select location</option>
          {recentLocations.length > 0 ? (
            <optgroup label="Recent">
              {recentLocations.map((place) => (
                <option key={place} value={place}>
                  {place}
                </option>
              ))}
            </optgroup>
          ) : null}
          {REMOTE_LOCATION_OPTIONS.map((place) => (
            <option key={place} value={place}>
              {place}
            </option>
          ))}
          <option value={REMOTE_LOCATION_OTHER}>{REMOTE_LOCATION_OTHER}</option>
        </select>
        {locationChoice === REMOTE_LOCATION_OTHER ? (
          <input
            id={`${scope}_other`}
            ref={otherRef}
            className={`${inputClassName} mt-2`}
            value={otherLocation}
            placeholder="Where are you working?"
            onChange={(event) => {
              event.target.setCustomValidity("");
              onOther(event.target.value);
            }}
          />
        ) : null}
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">
          Reason (optional)
        </span>
        <input
          id={`${scope}_reason`}
          ref={reasonRef}
          name="reason"
          className={inputClassName}
          value={reason}
          onChange={(event) => {
            event.target.setCustomValidity("");
            onReason(event.target.value);
          }}
        />
      </label>
    </div>
  );
}

export default function RemoteAttendancePanel() {
  const { toast } = useToast();
  const { alertError } = useAlert();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requests, setRequests] = useState<RemoteRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [locationChoice, setLocationChoice] = useState("");
  const [otherLocation, setOtherLocation] = useState("");
  const [reason, setReason] = useState("");
  const [locationReady, setLocationReady] = useState(false);
  const [pastDate, setPastDate] = useState("");
  const [pastIn, setPastIn] = useState("");
  const [pastOut, setPastOut] = useState("");
  const formScope = useRef<"today" | "past">("today");
  const locationRef = useRef<HTMLSelectElement>(null);
  const otherLocationRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const pastDateRef = useRef<HTMLInputElement>(null);
  const pastInRef = useRef<HTMLInputElement>(null);
  const pastOutRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/attendance/remote");
    const body = (await response.json().catch(() => null)) as {
      allowed?: boolean;
      requests?: RemoteRequest[];
      error?: string;
    } | null;
    if (!response.ok) {
      throw new Error(body?.error ?? "Could not load remote attendance.");
    }
    setAllowed(Boolean(body?.allowed));
    setRequests(body?.requests ?? []);
    setLoadFailed(false);
  }, []);

  useEffect(() => {
    void load().catch((loadError) => {
      setLoadFailed(true);
      setAllowed(false);
      void alertError(loadError);
    });
  }, [load, alertError]);

  const today = todayInAccra();
  const oldestIso = addCalendarDays(today, -31);
  const recentLocations = recentCustomLocations(
    requests.map((row) => row.location_note),
  );
  const locationNote =
    locationChoice === REMOTE_LOCATION_OTHER
      ? otherLocation.trim()
      : locationChoice.trim();
  const todayClockIn = requests.find(
    (row) =>
      row.work_date === today &&
      (row.status === "pending" || row.status === "approved") &&
      row.clock_out == null,
  );
  const clockedInToday = Boolean(todayClockIn);
  const hasTodayRequest = requests.some(
    (row) =>
      row.work_date === today &&
      (row.status === "pending" || row.status === "approved"),
  );

  useEffect(() => {
    if (locationReady || requests.length === 0) {
      return;
    }
    const latest = requests.find((row) => row.location_note?.trim())?.location_note;
    const next = preselectRemoteLocation(latest);
    if (!next.choice) {
      return;
    }
    setLocationChoice(next.choice);
    setOtherLocation(next.other);
    setLocationReady(true);
  }, [locationReady, requests]);

  function showFieldIssue(issue: RemoteFieldIssue | undefined): boolean {
    if (!issue) {
      return false;
    }
    const prefix = formScope.current;
    const named =
      issue.message === "Where are you working?"
        ? (`${prefix}_other` as const)
        : issue.field === "location_note"
          ? (`${prefix}_location` as const)
          : issue.field === "reason"
            ? (`${prefix}_reason` as const)
            : null;
    const field =
      (named ? document.getElementById(named) : null) ??
      (issue.field === "work_date"
        ? pastDateRef.current
        : issue.field === "clock_in"
          ? pastInRef.current
          : issue.field === "clock_out"
            ? pastOutRef.current
            : null);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
      return false;
    }
    field.setCustomValidity(issue.message);
    field.reportValidity();
    return true;
  }

  function clearField(
    field: { setCustomValidity(message: string): void } | null,
  ) {
    field?.setCustomValidity("");
  }

  function locationIssue(): RemoteFieldIssue | undefined {
    if (locationChoice === REMOTE_LOCATION_OTHER && !otherLocation.trim()) {
      return { field: "location_note", message: "Where are you working?" };
    }
    return remoteNoteIssues(locationNote, reason)[0];
  }

  async function submit(payload: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/attendance/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        const message = body?.error ?? "Could not save attendance.";
        if (
          message === "Location note and reason are required." ||
          message === "Location note is required."
        ) {
          setBusy(false);
          showFieldIssue(
            locationIssue() ?? {
              field: "location_note",
              message: "Location note is required.",
            },
          );
          return;
        }
        setBusy(false);
        await alertError(new Error(message));
        return;
      }
      toast(okMessage);
      setBusy(false);
      await load();
    } catch (submitError) {
      setBusy(false);
      await alertError(submitError);
    }
  }

  async function clockIn(event: FormEvent) {
    event.preventDefault();
    formScope.current = "today";
    const issue = locationIssue();
    if (showFieldIssue(issue)) {
      return;
    }
    clearField(locationRef.current);
    clearField(otherLocationRef.current);
    clearField(reasonRef.current);
    const geo = await readGeo();
    await submit(
      {
        action: "clock_in",
        location_note: locationNote.trim(),
        reason: reason.trim(),
        ...geo,
      },
      "Clock-in request sent for approval",
    );
  }

  async function clockOut() {
    await submit(
      {
        action: "clock_out",
        location_note: locationNote || todayClockIn?.location_note || undefined,
      },
      "Clock-out request sent",
    );
  }

  async function addPastDay(event: FormEvent) {
    event.preventDefault();
    formScope.current = "past";
    const issue =
      pastDayFieldIssues({
        workDate: pastDate,
        clockIn: pastIn,
        clockOut: pastOut,
      })[0] ?? locationIssue();
    if (showFieldIssue(issue)) {
      return;
    }
    clearField(pastDateRef.current);
    clearField(pastInRef.current);
    clearField(pastOutRef.current);
    clearField(locationRef.current);
    clearField(otherLocationRef.current);
    clearField(reasonRef.current);
    const geo = await readGeo();
    await submit(
      {
        action: "past_day",
        work_date: pastDate,
        clock_in: pastIn,
        clock_out: pastOut,
        location_note: locationNote.trim(),
        reason: reason.trim(),
        ...geo,
      },
      "Past day request sent for approval",
    );
  }

  async function cancelRequest(requestId: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/attendance/requests/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setBusy(false);
        await alertError(new Error(body?.error ?? "Could not cancel the request."));
        return;
      }
      toast("Request cancelled");
      setBusy(false);
      await load();
    } catch (cancelError) {
      setBusy(false);
      await alertError(cancelError);
    }
  }

  if (allowed == null) {
    return <p className="text-sm text-slate-600">Loading remote attendance…</p>;
  }

  if (loadFailed) {
    return null;
  }

  if (!allowed) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        Remote attendance is not enabled for your employee record.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <form
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(event) => void clockIn(event)}
      >
        <h3 className="text-base font-semibold text-[#0f2744]">Today</h3>
        <p className="mt-1 text-sm text-slate-600">
          Clock-in creates a pending request. Your approver records attendance
          only after approval. Location is stored only if the browser allows it.
        </p>
        <LocationFields
          scope="today"
          locationRef={locationRef}
          otherRef={otherLocationRef}
          reasonRef={reasonRef}
          locationChoice={locationChoice}
          otherLocation={otherLocation}
          reason={reason}
          recentLocations={recentLocations}
          onLocation={(value) => {
            setLocationChoice(value);
            locationRef.current?.setCustomValidity("");
          }}
          onOther={(value) => {
            setOtherLocation(value);
            otherLocationRef.current?.setCustomValidity("");
          }}
          onReason={(value) => {
            setReason(value);
            reasonRef.current?.setCustomValidity("");
          }}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <DashboardButton type="submit" disabled={busy || hasTodayRequest}>
            Clock in now
          </DashboardButton>
          <DashboardButton
            type="button"
            variant="secondary"
            disabled={busy || !clockedInToday}
            onClick={() => void clockOut()}
          >
            Clock out now
          </DashboardButton>
          {clockedInToday ? (
            <p className="text-sm text-slate-600">
              You&apos;re clocked in since {formatClock(todayClockIn?.clock_in ?? null)}
            </p>
          ) : null}
        </div>
      </form>

      <form
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(event) => void addPastDay(event)}
      >
        <h3 className="text-base font-semibold text-[#0f2744]">Add past day</h3>
        <p className="mt-1 text-sm text-slate-600">
          Both times are required. Dates can be today or up to 31 days back.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Date</span>
            <input
              ref={pastDateRef}
              name="work_date"
              type="date"
              className={inputClassName}
              value={pastDate}
              min={oldestIso}
              max={today}
              onChange={(event) => {
                setPastDate(event.target.value);
                event.target.setCustomValidity("");
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Clock in</span>
            <TimePickerField
              ref={pastInRef}
              name="clock_in"
              aria-label="Clock in"
              value={pastIn}
              onChange={(value) => {
                setPastIn(value);
                pastInRef.current?.setCustomValidity("");
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Clock out</span>
            <TimePickerField
              ref={pastOutRef}
              name="clock_out"
              aria-label="Clock out"
              value={pastOut}
              onChange={(value) => {
                setPastOut(value);
                pastOutRef.current?.setCustomValidity("");
              }}
            />
          </label>
        </div>
        <LocationFields
          scope="past"
          locationChoice={locationChoice}
          otherLocation={otherLocation}
          reason={reason}
          recentLocations={recentLocations}
          onLocation={(value) => setLocationChoice(value)}
          onOther={(value) => setOtherLocation(value)}
          onReason={(value) => setReason(value)}
        />
        <DashboardButton type="submit" className="mt-4" disabled={busy}>
          Submit past day
        </DashboardButton>
      </form>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-[#0f2744]">My requests</h3>
        <div className="mt-4">
          <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Clock in</th>
                <th className={scrollableTableThClassName}>Clock out</th>
                <th className={scrollableTableThClassName}>Location</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}> </th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    No remote attendance requests yet.
                  </td>
                </tr>
              ) : (
                requests.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">{row.work_date}</td>
                    <td className="px-2 py-2">{formatWhen(row.clock_in)}</td>
                    <td className="px-2 py-2">{formatWhen(row.clock_out)}</td>
                    <td className="px-2 py-2">{row.location_note?.trim() || "—"}</td>
                    <td className="px-2 py-2 capitalize">{row.status}</td>
                    <td className="px-2 py-2">
                      {row.status === "pending" ? (
                        <button
                          type="button"
                          className="text-red-700 underline"
                          disabled={busy}
                          onClick={() => void cancelRequest(row.id)}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </ScrollableTable>
        </div>
      </section>
    </div>
  );
}
