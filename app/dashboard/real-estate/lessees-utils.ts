export type LesseeStatus = "active" | "former";

export type LesseeListRow = {
  lesseeId: string;
  tenantId: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: LesseeStatus;
  privateNotes: string | null;
  createdAt: string;
};

export const LESSEE_STATUS_OPTIONS: Array<{
  value: LesseeStatus;
  label: string;
}> = [
  { value: "active", label: "Active" },
  { value: "former", label: "Former" },
];

export function formatLesseeStatus(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const match = LESSEE_STATUS_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatLesseeDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function isLesseeStatus(value: string): value is LesseeStatus {
  return LESSEE_STATUS_OPTIONS.some((option) => option.value === value);
}
