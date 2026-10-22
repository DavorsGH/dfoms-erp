export type DirectorsBoardTabId =
  | "scorecard"
  | "dividends"
  | "shareholders"
  | "settings";

export const DIRECTORS_BOARD_TABS: Array<{
  id: DirectorsBoardTabId;
  label: string;
}> = [
  { id: "scorecard", label: "Scorecard" },
  { id: "dividends", label: "Dividends" },
  { id: "shareholders", label: "Shareholders" },
  { id: "settings", label: "Settings" },
];

export function parseDirectorsBoardTab(
  value: string | null | undefined,
): DirectorsBoardTabId {
  if (
    value === "dividends" ||
    value === "shareholders" ||
    value === "settings" ||
    value === "scorecard"
  ) {
    return value;
  }
  return "scorecard";
}

export function directorsBoardHref(tab: DirectorsBoardTabId, monthKey?: string): string {
  const params = new URLSearchParams();
  if (tab !== "scorecard") {
    params.set("tab", tab);
  }
  if (monthKey?.trim()) {
    params.set("month", monthKey.trim());
  }
  const q = params.toString();
  return q ? `/dashboard/directors?${q}` : "/dashboard/directors";
}
