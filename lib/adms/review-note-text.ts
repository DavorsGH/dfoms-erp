const REVIEW_NOTE_LABELS: Record<string, string> = {
  future_time: "Punch time is in the future (held until then)",
  missing_clock_out: "No clock-out recorded",
  processing_error: "Could not be processed — use Reprocess",
  manual_row_exists: "An attendance row already exists for this day",
};

export const UNMAPPED_PIN_LABEL = "PIN not linked to any employee";

/** Plain Needs review wording. The stored code stays available as the tooltip. */
export function reviewNoteLabel(input: {
  processNote: string | null | undefined;
  staffId: string | null | undefined;
  otherContractText?: string | null;
}): string {
  if (input.otherContractText?.trim()) {
    return input.otherContractText.trim();
  }
  const note = (input.processNote ?? "").trim();
  if (!input.staffId) {
    return UNMAPPED_PIN_LABEL;
  }
  return REVIEW_NOTE_LABELS[note] ?? (note || "Punch stored but not processed.");
}

export function reviewNoteCode(input: {
  processNote: string | null | undefined;
  staffId: string | null | undefined;
}): string {
  const note = (input.processNote ?? "").trim();
  if (note) {
    return note;
  }
  return input.staffId ? "" : "unmapped";
}
