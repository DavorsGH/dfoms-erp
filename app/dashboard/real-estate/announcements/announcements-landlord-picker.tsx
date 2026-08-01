"use client";

import { useRouter } from "next/navigation";
import type { LandlordListRow } from "../landlords-utils";

type AnnouncementsLandlordPickerProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  basePath: string;
  landlordsError?: string | null;
};

const selectClassName =
  "w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function AnnouncementsLandlordPicker({
  landlords,
  selectedLandlordId,
  basePath,
  landlordsError,
}: AnnouncementsLandlordPickerProps) {
  const router = useRouter();

  function handleLandlordChange(tenantId: string) {
    if (!tenantId) {
      router.push(basePath);
      return;
    }
    router.push(`${basePath}?landlord=${encodeURIComponent(tenantId)}`);
  }

  return (
    <div className="mb-6 space-y-2">
      {landlordsError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {landlordsError}
        </p>
      ) : null}
      <label className="mb-1 block text-sm font-medium text-slate-700">
        Landlord
      </label>
      <select
        value={selectedLandlordId ?? ""}
        onChange={(event) => handleLandlordChange(event.target.value)}
        className={selectClassName}
      >
        <option value="">Select a landlord</option>
        {landlords.map((landlord) => (
          <option key={landlord.tenantId} value={landlord.tenantId}>
            {landlord.name}
            {landlord.landlordType === "platform_only"
              ? " (Platform only)"
              : ""}
          </option>
        ))}
      </select>
      {!selectedLandlordId ? (
        <p className="text-sm text-slate-500">
          Select a landlord to manage portal announcement templates and
          campaigns for that landlord&apos;s tenants.
        </p>
      ) : null}
    </div>
  );
}
