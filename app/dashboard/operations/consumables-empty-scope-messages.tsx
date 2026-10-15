"use client";

export const CONSUMABLES_NO_SITES_MESSAGE =
  "No sites in this business unit. Switch business unit at the top, or add a site under Operations > Sites.";

export const CONSUMABLES_NO_ITEMS_MESSAGE =
  "No items in this business unit yet.";

export function ConsumablesScopeNotice({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {message}
    </p>
  );
}
