import { formatUnit } from "@/utils/units-of-measure";

export function roundAssistantAmount(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatAssistantUnit(value: string | null | undefined): string {
  const formatted = formatUnit(value);
  return formatted || "";
}
