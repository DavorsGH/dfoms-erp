export type PushPersona = "staff" | "lessee" | "landlord";

export const PUSH_PERSONAS: readonly PushPersona[] = [
  "staff",
  "lessee",
  "landlord",
];

export function isPushPersona(value: unknown): value is PushPersona {
  return (
    typeof value === "string" &&
    (PUSH_PERSONAS as readonly string[]).includes(value)
  );
}
