"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pdf } from "@react-pdf/renderer";
import type { ClientEntry } from "./clients-utils";
import { inputClassName } from "../employees/employee-record-utils";
import {
  resolveBrandingLogoUrl,
  resolveDocumentLogoUrl,
  resolveInvoiceCompanyName,
  resolveSignatureImageUrl,
} from "@/app/dashboard/finance/client-invoices/client-invoice-display-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { useTenantBranding } from "../tenant-branding-context";
import WorkspaceLogo from "../workspace-logo";
import { useBusinessUnitView } from "@/app/dashboard/business-unit-view-context";
import { resolveBusinessUnitDocumentContactFromUnits } from "@/utils/business-unit-document-contact-types";
import {
  buildClientAssignmentProjectCodes,
  buildDutyRosterViewModel,
  filterHistoryForClient,
  formatDutyRosterEffectiveLabel,
  getUnassignedRosterSites,
  resolveDutyRosterBusinessUnitId,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
  type DutyRosterViewModel,
  type RosterConfigRecord,
  type RosterHistoryRecord,
  type UnassignedRosterSite,
} from "./duty-roster-utils";
import { getRosterConfigForClient } from "./roster-config-utils";
import {
  formatRotationAuditTimestamp,
  getRotationMetadataForClient,
  isRotationApproved,
  resolveRotationStartAudit,
  type RosterRotationMetadataRecord,
} from "./roster-rotation-metadata-utils";
import {
  AUTHORIZED_BY_OTHER,
  formatAuthorizedSignerLabel,
  resolveAuthorizedByFields,
  resolveAuthorizedByFormState,
  type ClientInvoiceAuthorizedSignerOption,
} from "@/utils/client-invoices-types";
import {
  buildDutyRosterPdfFileName,
  loadTenantSignatureDataUrl,
  resolveDocumentSignatureImageUrl,
  type DutyRosterPdfPayload,
} from "./duty-roster-document-utils";
import DutyRosterPdfDocument from "./duty-roster-pdf-document";

type DutyRosterProps = {
  initialClients: ClientEntry[];
  initialConfigs: RosterConfigRecord[];
  initialEmployees: DutyRosterEmployee[];
  initialProjects: DutyRosterProject[];
  initialSites: DutyRosterSite[];
  initialHistory: RosterHistoryRecord[];
  initialRotationMetadata: RosterRotationMetadataRecord[];
  initialAuthorizedSigners: ClientInvoiceAuthorizedSignerOption[];
  fetchError: string | null;
  preparedByDefault: string;
  canStartRotation: boolean;
};

function formatTodayLabel(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function renderRosterRows(rows: DutyRosterViewModel["rows"]) {
  if (rows.length === 0) {
    return (
      <tr>
        <td
          colSpan={6}
          className="px-4 py-8 text-center text-sm text-slate-500"
        >
          No active employees are assigned to this customer&apos;s facilities yet.
        </td>
      </tr>
    );
  }

  return rows.map((row) => (
    <tr
      key={row.siteCode}
      className={row.isUnderStaffed ? "bg-amber-50" : undefined}
    >
      <td className="px-4 py-3 font-medium text-[#0f2744]">
        <span className="inline-flex flex-wrap items-center gap-2">
          {row.facilityName}
          {row.isUnderStaffed ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Short staffed
            </span>
          ) : null}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-slate-700">{row.morningShift}</td>
      <td className="px-4 py-3 text-sm text-slate-700">{row.afternoonShift}</td>
      <td className="px-4 py-3 text-sm text-slate-700">{row.supervisors}</td>
      <td className="px-4 py-3 text-sm text-slate-700">{row.requiredStaff}</td>
      <td
        className={`px-4 py-3 text-sm ${
          row.isUnderStaffed ? "font-medium text-amber-900" : "text-slate-700"
        }`}
      >
        {row.totalStaff}
      </td>
    </tr>
  ));
}

function renderRosterTotalsRow(totals: DutyRosterViewModel["totals"]) {
  return (
    <tr
      className={`font-semibold text-[#0f2744] ${
        totals.isUnderStaffed ? "bg-amber-100" : "bg-slate-100"
      }`}
    >
      <td className="px-4 py-3">
        <span className="inline-flex flex-wrap items-center gap-2">
          TOTAL
          {totals.isUnderStaffed ? (
            <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-900">
              Short staffed
            </span>
          ) : null}
        </span>
      </td>
      <td className="px-4 py-3" colSpan={3} />
      <td className="px-4 py-3">{totals.requiredStaff}</td>
      <td
        className={`px-4 py-3 ${
          totals.isUnderStaffed ? "font-semibold text-amber-900" : ""
        }`}
      >
        {totals.totalStaff}
      </td>
    </tr>
  );
}

function UnassignedSitesNotice({
  sites,
}: {
  sites: UnassignedRosterSite[];
}) {
  if (sites.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">Unassigned Sites</p>
      <p className="mt-1 text-amber-900">
        The following sites are missing a linked contract project and are
        excluded from customer rosters until assigned in Administration:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {sites.map((site) => (
          <li key={site.siteCode}>
            {site.siteName}{" "}
            <span className="text-amber-800">({site.siteCode})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DutyRoster({
  initialClients,
  initialConfigs,
  initialEmployees,
  initialProjects,
  initialSites,
  initialHistory,
  initialRotationMetadata,
  initialAuthorizedSigners,
  fetchError,
  preparedByDefault,
  canStartRotation,
}: DutyRosterProps) {
  const router = useRouter();
  const branding = useTenantBranding();
  const { units } = useBusinessUnitView();
  const { signatureImageUrl } = branding;
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedRotationNumber, setSelectedRotationNumber] = useState<
    number | null
  >(null);
  const [preparedBy, setPreparedBy] = useState(preparedByDefault);
  const [approvedBySelection, setApprovedBySelection] = useState("");
  const [approvedByOtherName, setApprovedByOtherName] = useState("");
  const [approvedByOtherTitle, setApprovedByOtherTitle] = useState("");
  const [rosterDate, setRosterDate] = useState(formatTodayLabel());
  const [startingRotation, setStartingRotation] = useState(false);
  const [approvingRotation, setApprovingRotation] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printSignatureDataUrl, setPrintSignatureDataUrl] = useState<string | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const selectedClient = useMemo(
    () =>
      initialClients.find((client) => client.client_id === selectedClientId) ??
      null,
    [initialClients, selectedClientId],
  );

  const selectedConfig = useMemo(
    () =>
      selectedClientId
        ? getRosterConfigForClient(initialConfigs, selectedClientId)
        : null,
    [initialConfigs, selectedClientId],
  );

  const unassignedSites = useMemo(
    () =>
      selectedClientId
        ? getUnassignedRosterSites(initialSites, selectedClientId)
        : [],
    [initialSites, selectedClientId],
  );

  const data = useMemo(() => {
    if (!selectedClient || !selectedConfig) {
      return null;
    }

    return buildDutyRosterViewModel({
      clientId: selectedClient.client_id,
      clientName: selectedClient.client_name,
      config: selectedConfig,
      employees: initialEmployees,
      projects: initialProjects,
      sites: initialSites,
      history: initialHistory,
      viewRotationNumber: selectedRotationNumber,
    });
  }, [
    selectedClient,
    selectedConfig,
    initialEmployees,
    initialProjects,
    initialSites,
    initialHistory,
    selectedRotationNumber,
  ]);

  const rotationIndex = useMemo(() => {
    if (!data) {
      return -1;
    }
    return data.rotationOptions.findIndex(
      (option) => option.rotationNumber === data.viewRotationNumber,
    );
  }, [data]);

  const clientHistory = useMemo(() => {
    if (!selectedClientId) {
      return [];
    }

    const clientProjectCodes = buildClientAssignmentProjectCodes(
      initialSites,
      initialProjects,
      selectedClientId,
    );

    return filterHistoryForClient(
      initialHistory,
      initialEmployees,
      clientProjectCodes,
    );
  }, [
    selectedClientId,
    initialHistory,
    initialEmployees,
    initialSites,
    initialProjects,
  ]);

  const rotationMetadata = useMemo(() => {
    if (!selectedClientId || !data) {
      return null;
    }

    return getRotationMetadataForClient(
      initialRotationMetadata,
      selectedClientId,
      data.viewRotationNumber,
    );
  }, [selectedClientId, data, initialRotationMetadata]);

  const rotationStartAudit = useMemo(() => {
    if (!data) {
      return null;
    }

    return resolveRotationStartAudit(
      rotationMetadata,
      clientHistory,
      data.viewRotationNumber,
    );
  }, [rotationMetadata, clientHistory, data]);

  const isRotationApprovedState = isRotationApproved(rotationMetadata);
  const isSignatureLocked = Boolean(
    data?.isHistoricalView || isRotationApprovedState,
  );

  const approvedDisplay = useMemo(() => {
    if (!isRotationApprovedState || !rotationMetadata) {
      return null;
    }

    return {
      name: rotationMetadata.approved_by_name?.trim() ?? "",
      title: rotationMetadata.approved_by_title?.trim() ?? "",
      approvedAt: rotationMetadata.approved_at
        ? formatRotationAuditTimestamp(rotationMetadata.approved_at)
        : "",
    };
  }, [isRotationApprovedState, rotationMetadata]);

  useEffect(() => {
    if (!rotationMetadata || !isRotationApprovedState) {
      setApprovedBySelection("");
      setApprovedByOtherName("");
      setApprovedByOtherTitle("");
      if (!data?.isHistoricalView) {
        setRosterDate(formatTodayLabel());
      }
      return;
    }

    const formState = resolveAuthorizedByFormState(
      {
        authorized_by_name: rotationMetadata.approved_by_name,
        authorized_by_title: rotationMetadata.approved_by_title,
      },
      initialAuthorizedSigners,
    );

    setApprovedBySelection(formState.authorized_by_selection);
    setApprovedByOtherName(formState.authorized_by_other_name);
    setApprovedByOtherTitle(formState.authorized_by_other_title);

    if (rotationMetadata.approved_at) {
      setRosterDate(formatRotationAuditTimestamp(rotationMetadata.approved_at));
    }
  }, [
    rotationMetadata,
    isRotationApprovedState,
    initialAuthorizedSigners,
    data?.isHistoricalView,
  ]);

  const resolvedSignatureImageUrl = useMemo(
    () => resolveSignatureImageUrl(signatureImageUrl),
    [signatureImageUrl],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPrintSignature() {
      if (!isRotationApprovedState) {
        setPrintSignatureDataUrl(null);
        return;
      }

      const dataUrl =
        (await loadTenantSignatureDataUrl()) ??
        (resolvedSignatureImageUrl
          ? await resolveDocumentSignatureImageUrl(resolvedSignatureImageUrl)
          : null);

      if (!cancelled) {
        setPrintSignatureDataUrl(dataUrl);
      }
    }

    void loadPrintSignature();

    return () => {
      cancelled = true;
    };
  }, [resolvedSignatureImageUrl, isRotationApprovedState]);

  function handleClientChange(clientId: string) {
    setSelectedClientId(clientId);
    setSelectedRotationNumber(null);
  }

  function handleRotationSelect(rotationNumber: number) {
    if (!data) {
      return;
    }
    setSelectedRotationNumber(
      rotationNumber === data.currentRotationNumber ? null : rotationNumber,
    );
  }

  function handlePreviousRotation() {
    if (!data || rotationIndex < 0) {
      return;
    }
    const nextOption = data.rotationOptions[rotationIndex + 1];
    if (nextOption) {
      handleRotationSelect(nextOption.rotationNumber);
    }
  }

  function handleNextRotation() {
    if (!data || rotationIndex <= 0) {
      return;
    }
    const nextOption = data.rotationOptions[rotationIndex - 1];
    if (nextOption) {
      handleRotationSelect(nextOption.rotationNumber);
    }
  }

  const effectiveLabel = useMemo(() => {
    if (!data) {
      return "";
    }

    return formatDutyRosterEffectiveLabel(
      data.summary.cycleStartDate,
      data.summary.cycleEndDate,
    );
  }, [data]);

  const rosterDocumentContact = useMemo(() => {
    if (!selectedClientId) {
      return null;
    }

    const businessUnitId = resolveDutyRosterBusinessUnitId(
      initialSites,
      initialProjects,
      selectedClientId,
    );
    return resolveBusinessUnitDocumentContactFromUnits(units, businessUnitId);
  }, [selectedClientId, initialSites, initialProjects, units]);

  const companyLegalName = resolveInvoiceCompanyName(
    branding,
    null,
    rosterDocumentContact,
  );
  const companyLogoUrl = resolveDocumentLogoUrl(
    branding,
    rosterDocumentContact,
  );

  const pdfPayload = useMemo((): DutyRosterPdfPayload | null => {
    if (!data) {
      return null;
    }

    return {
      companyLegalName,
      companyLogoUrl: resolveBrandingLogoUrl(companyLogoUrl),
      clientName: data.clientName,
      effectiveLabel,
      rotationLabel: data.summary.currentRotationLabel,
      morningTime: data.summary.morningTime,
      afternoonTime: data.summary.afternoonTime,
      supervisorTime: data.summary.supervisorTime,
      rows: data.rows,
      totals: data.totals,
      preparedBy,
      approvedByName: approvedDisplay?.name ?? null,
      approvedByTitle: approvedDisplay?.title ?? null,
      approvedAt: approvedDisplay?.approvedAt ?? null,
      rosterDate,
      signatureImageUrl: resolvedSignatureImageUrl,
    };
  }, [
    data,
    companyLegalName,
    companyLogoUrl,
    effectiveLabel,
    preparedBy,
    approvedDisplay,
    rosterDate,
    resolvedSignatureImageUrl,
  ]);

  async function handleStartRotation() {
    if (!data || !selectedClientId) {
      return;
    }

    const confirmed = window.confirm(
      `Start Rotation ${data.currentRotationNumber + 1} for ${data.clientName}?\n\nThis will advance the cycle to begin ${formatShortDate(data.summary.nextRotationDate)} and record assignment changes in Roster History.`,
    );

    if (!confirmed) {
      return;
    }

    setStartingRotation(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch("/api/operations/start-rotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: selectedClientId }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        insertedCount?: number;
      };

      if (!response.ok) {
        setActionError(payload.error ?? "Failed to start new rotation.");
        return;
      }

      setActionMessage(
        payload.message ??
          `Rotation started. ${payload.insertedCount ?? 0} change(s) recorded.`,
      );
      router.refresh();
    } catch {
      setActionError("Failed to start new rotation.");
    } finally {
      setStartingRotation(false);
    }
  }

  async function handleApproveRotation() {
    if (!data || !selectedClientId || isSignatureLocked) {
      return;
    }

    const approvedBy = resolveAuthorizedByFields(
      approvedBySelection,
      approvedByOtherName,
      approvedByOtherTitle,
      initialAuthorizedSigners,
    );

    if (!approvedBy.authorized_by_name?.trim()) {
      setActionError("Select an approver before approving the roster.");
      return;
    }

    setApprovingRotation(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch("/api/operations/approve-roster-rotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: selectedClientId,
          rotation_number: data.viewRotationNumber,
          approved_by_selection: approvedBySelection,
          approved_by_other_name: approvedByOtherName,
          approved_by_other_title: approvedByOtherTitle,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setActionError(payload.error ?? "Failed to approve duty roster.");
        return;
      }

      setActionMessage(payload.message ?? "Duty roster approved.");
      router.refresh();
    } catch {
      setActionError("Failed to approve duty roster.");
    } finally {
      setApprovingRotation(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const handleDownloadPdf = useCallback(async () => {
    if (!pdfPayload || !data) {
      return;
    }

    setDownloadingPdf(true);
    setActionError(null);

    try {
      const signatureForPdf = await resolveDocumentSignatureImageUrl(
        pdfPayload.signatureImageUrl,
      );
      const blob = await pdf(
        <DutyRosterPdfDocument
          {...pdfPayload}
          signatureImageUrl={signatureForPdf}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildDutyRosterPdfFileName(
        data.clientName,
        data.viewRotationNumber,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setActionError("Unable to generate PDF. Try again or use Print.");
    } finally {
      setDownloadingPdf(false);
    }
  }, [pdfPayload, data]);

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {fetchError}
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media not print {
          #duty-roster-print-area {
            display: none !important;
          }
        }

        @media print {
          body * {
            visibility: hidden;
          }

          #duty-roster-print-area,
          #duty-roster-print-area * {
            visibility: visible;
          }

          #duty-roster-print-area {
            display: block !important;
            position: absolute;
            inset: 0;
            width: 100%;
            padding: 24px;
            background: white;
          }

          #duty-roster-print-area img {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="no-print space-y-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Customer
            </label>
              <select
              value={selectedClientId}
              onChange={(event) => handleClientChange(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select customer</option>
              {initialClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <UnassignedSitesNotice sites={unassignedSites} />

        {!selectedClientId ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            Select a customer to view their roster.
          </p>
        ) : null}

        {selectedClientId && !selectedConfig ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No roster configuration exists for {selectedClient?.client_name}.
            Add shift pattern and cycle settings in Administration &gt; Roster
            Settings before viewing this customer&apos;s roster.
          </p>
        ) : null}

        {data ? (
          <>
            {actionError ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {actionError}
              </p>
            ) : null}
            {actionMessage ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {actionMessage}
              </p>
            ) : null}

            {data.isHistoricalView ? (
              <section className="rounded-md border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Viewing a past rotation in read-only mode. Assignment changes are
                reconstructed from roster history; employees with no history rows
                keep their current assignment as a fallback.
              </section>
            ) : null}

            {!data.isHistoricalView && isRotationApprovedState ? (
              <section className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                This rotation has been approved and is locked. Start a new rotation
                when the next cycle begins.
              </section>
            ) : null}

            <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-4">
              <div className="xl:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {data.isHistoricalView ? "Rotation" : "Current Rotation"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePreviousRotation}
                    disabled={
                      rotationIndex < 0 ||
                      rotationIndex >= data.rotationOptions.length - 1
                    }
                    className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous rotation"
                  >
                    ←
                  </button>
                  <select
                    value={String(data.viewRotationNumber)}
                    onChange={(event) =>
                      handleRotationSelect(Number(event.target.value))
                    }
                    className={`${inputClassName} min-w-[min(100%,320px)] flex-1`}
                    aria-label="Select rotation"
                  >
                    {data.rotationOptions.map((option) => (
                      <option
                        key={option.rotationNumber}
                        value={option.rotationNumber}
                      >
                        {option.label}
                        {option.isCurrent ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleNextRotation}
                    disabled={rotationIndex <= 0}
                    className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next rotation"
                  >
                    →
                  </button>
                </div>
                {rotationStartAudit?.startedByName &&
                rotationStartAudit.startedAt ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Started by {rotationStartAudit.startedByName} on{" "}
                    {formatRotationAuditTimestamp(rotationStartAudit.startedAt)}
                  </p>
                ) : null}
              </div>
              {!data.isHistoricalView ? (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Next Rotation
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#0f2744]">
                      {formatShortDate(data.summary.nextRotationDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Days to Rotation
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#0f2744]">
                      {data.summary.daysToRotation} day
                      {data.summary.daysToRotation === 1 ? "" : "s"}
                    </p>
                  </div>
                </>
              ) : (
                <div className="md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Effective Period
                  </p>
                  <p className="mt-1 text-sm font-medium text-[#0f2744]">
                    {effectiveLabel}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Staff Assigned
                </p>
                <p className="mt-1 text-sm font-medium text-[#0f2744]">
                  {data.summary.staffAssignedCount} of {data.summary.totalActiveCount}{" "}
                  required ({data.summary.staffAssignedPercent}%)
                </p>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              {canStartRotation && !data.isHistoricalView ? (
              <button
                type="button"
                onClick={handleStartRotation}
                disabled={startingRotation}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startingRotation ? "Starting Rotation…" : "Start New Rotation"}
              </button>
              ) : null}
              <button
                type="button"
                onClick={handlePrint}
                className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
              >
                Print
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={downloadingPdf}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloadingPdf ? "Generating PDF…" : "Download PDF"}
              </button>
              <Link
                href="/dashboard/operations/roster-history"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                View Roster History
              </Link>
            </div>

            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Facility</th>
                    <th className={scrollableTableThClassName}>
                      Morning Shift
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        {data.summary.morningTime}
                      </span>
                    </th>
                    <th className={scrollableTableThClassName}>
                      Afternoon Shift
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        {data.summary.afternoonTime}
                      </span>
                    </th>
                    <th className={scrollableTableThClassName}>
                      Supervisor(s)
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        {data.summary.supervisorTime}
                      </span>
                    </th>
                    <th className={scrollableTableThClassName}>Required Staff</th>
                    <th className={scrollableTableThClassName}>Actual Staff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {renderRosterRows(data.rows)}
                  {data.rows.length > 0 ? renderRosterTotalsRow(data.totals) : null}
                </tbody>
              </table>
            </ScrollableTable>

            <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Prepared By
                  </label>
                  <input
                    type="text"
                    value={preparedBy}
                    onChange={(event) => setPreparedBy(event.target.value)}
                    readOnly={isSignatureLocked}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Approved By
                  </label>
                  {isSignatureLocked ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                      <p className="font-medium">
                        {approvedDisplay?.name || "—"}
                      </p>
                      {approvedDisplay?.title ? (
                        <p className="mt-1 text-slate-600">{approvedDisplay.title}</p>
                      ) : null}
                      {approvedDisplay?.approvedAt ? (
                        <p className="mt-2 text-sm font-medium text-slate-700">
                          Approved on {approvedDisplay.approvedAt}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <select
                        value={approvedBySelection}
                        onChange={(event) =>
                          setApprovedBySelection(event.target.value)
                        }
                        className={inputClassName}
                      >
                        <option value="">Select approver</option>
                        {initialAuthorizedSigners.map((signer) => (
                          <option key={signer.employee_id} value={signer.employee_id}>
                            {formatAuthorizedSignerLabel(signer)}
                          </option>
                        ))}
                        <option value={AUTHORIZED_BY_OTHER}>Other</option>
                      </select>
                      {approvedBySelection === AUTHORIZED_BY_OTHER ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              Name
                            </label>
                            <input
                              type="text"
                              value={approvedByOtherName}
                              onChange={(event) =>
                                setApprovedByOtherName(event.target.value)
                              }
                              className={inputClassName}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              Title/Role
                            </label>
                            <input
                              type="text"
                              value={approvedByOtherTitle}
                              onChange={(event) =>
                                setApprovedByOtherTitle(event.target.value)
                              }
                              className={inputClassName}
                            />
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Date
                  </label>
                  <input
                    type="text"
                    value={rosterDate}
                    onChange={(event) => setRosterDate(event.target.value)}
                    readOnly={isSignatureLocked}
                    className={inputClassName}
                  />
                </div>
              </div>

              {canStartRotation &&
              !data.isHistoricalView &&
              !isRotationApprovedState ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleApproveRotation}
                    disabled={approvingRotation || !approvedBySelection}
                    className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {approvingRotation ? "Approving…" : "Approve Roster"}
                  </button>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>

      {data ? (
        <div id="duty-roster-print-area">
          <header className="mb-6 border-b border-slate-300 pb-4 text-center">
            <div className="mb-3 flex justify-center">
              <WorkspaceLogo
                workspaceLogoUrl={companyLogoUrl}
                name={companyLegalName}
                size="md"
              />
            </div>
            <p className="text-lg font-semibold text-[#0f2744]">
              {companyLegalName}
            </p>
            <h1 className="mt-2 text-xl font-bold text-[#0f2744]">Duty Roster</h1>
            <p className="mt-2 text-sm font-semibold text-slate-800">
              {data.clientName}
            </p>
            <p className="mt-2 text-sm text-slate-700">
              Effective: {effectiveLabel}
            </p>
            <p className="text-sm text-slate-700">{data.summary.currentRotationLabel}</p>
          </header>

          <table className="mb-6 w-full border-collapse text-xs">
            <thead>
              <tr className="border border-slate-400 bg-slate-100">
                <th className="border border-slate-400 px-2 py-2 text-left">
                  Facility
                </th>
                <th className="border border-slate-400 px-2 py-2 text-left">
                  Morning Shift
                  <div className="font-normal text-slate-600">
                    {data.summary.morningTime}
                  </div>
                </th>
                <th className="border border-slate-400 px-2 py-2 text-left">
                  Afternoon Shift
                  <div className="font-normal text-slate-600">
                    {data.summary.afternoonTime}
                  </div>
                </th>
                <th className="border border-slate-400 px-2 py-2 text-left">
                  Supervisor(s)
                  <div className="font-normal text-slate-600">
                    {data.summary.supervisorTime}
                  </div>
                </th>
                <th className="border border-slate-400 px-2 py-2 text-right">
                  Required
                </th>
                <th className="border border-slate-400 px-2 py-2 text-right">
                  Actual
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.siteCode}>
                  <td className="border border-slate-400 px-2 py-2 align-top">
                    {row.facilityName}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 align-top">
                    {row.morningShift}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 align-top">
                    {row.afternoonShift}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 align-top">
                    {row.supervisors}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 text-right align-top">
                    {row.requiredStaff}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 text-right align-top">
                    {row.totalStaff}
                  </td>
                </tr>
              ))}
              {data.rows.length > 0 ? (
                <tr
                  className={`font-semibold ${
                    data.totals.isUnderStaffed ? "bg-amber-100" : "bg-slate-100"
                  }`}
                >
                  <td className="border border-slate-400 px-2 py-2">TOTAL</td>
                  <td className="border border-slate-400 px-2 py-2" colSpan={3} />
                  <td className="border border-slate-400 px-2 py-2 text-right">
                    {data.totals.requiredStaff}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 text-right">
                    {data.totals.totalStaff}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <footer className="grid grid-cols-3 gap-4 border-t border-slate-300 pt-4 text-sm">
            <div>
              <p className="text-slate-600">Prepared By</p>
              <p className="mt-6 border-b border-slate-400 pb-1 font-medium text-slate-900">
                {preparedBy || " "}
              </p>
            </div>
            <div>
              <p className="text-slate-600">Approved By</p>
              {approvedDisplay?.name ? (
                <>
                  {printSignatureDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={printSignatureDataUrl}
                      alt="Approved signature"
                      className="mt-2 h-12 max-w-[180px] object-contain"
                    />
                  ) : null}
                  <p
                    className={`${
                      printSignatureDataUrl ? "mt-2" : "mt-6"
                    } border-b border-slate-400 pb-1 font-medium text-slate-900`}
                  >
                    {approvedDisplay.name}
                  </p>
                  {approvedDisplay.title ? (
                    <p className="mt-1 text-sm text-slate-700">{approvedDisplay.title}</p>
                  ) : null}
                  {approvedDisplay.approvedAt ? (
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      Approved on {approvedDisplay.approvedAt}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-6 border-b border-slate-400 pb-1 font-medium text-slate-900">
                  {" "}
                </p>
              )}
            </div>
            <div>
              <p className="text-slate-600">Date</p>
              <p className="mt-6 border-b border-slate-400 pb-1 font-medium text-slate-900">
                {rosterDate || " "}
              </p>
            </div>
          </footer>
        </div>
      ) : null}
    </>
  );
}
