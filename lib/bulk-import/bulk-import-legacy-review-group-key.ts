import type { BulkImportType } from "@/lib/bulk-import/types";
import { getBulkImportTargetField } from "@/lib/bulk-import/target-fields";

export function resolveLegacyReviewGroupKey(input: {
  message: string;
  fieldKey: string | null;
  importType: BulkImportType;
}): string {
  const { message, fieldKey, importType } = input;
  const normalized = message.toLowerCase();

  if (fieldKey) {
    if (normalized.includes(" is required")) {
      return `required:${fieldKey}`;
    }
    if (normalized.includes("must be one of:")) {
      return `enum:${fieldKey}`;
    }
    if (
      normalized.includes("must be a valid number") ||
      normalized.includes("must have at most") ||
      normalized.includes("is too large")
    ) {
      return `numeric:${fieldKey}`;
    }
    if (
      normalized.includes("is not a valid date") ||
      normalized.includes("is outside the allowed date range")
    ) {
      return `date_invalid:${fieldKey}`;
    }
    if (normalized.includes("cannot be before")) {
      return `date_range:${fieldKey}`;
    }
  }

  if (normalized.includes("matches multiple suppliers")) {
    return "lookup_ambiguous:supplier_name";
  }
  if (normalized.includes("matches multiple")) {
    if (fieldKey) {
      return `lookup_ambiguous:${fieldKey}`;
    }
  }

  if (/^duplicate\s+[\w]+:\s*repeated in this file/i.test(message)) {
    const match = /^duplicate\s+([\w]+):/i.exec(message);
    const dupField = match?.[1] ?? fieldKey;
    if (dupField) {
      return `duplicate_in_file:${dupField}:legacy`;
    }
  }

  if (normalized.startsWith("warning: possible duplicate")) {
    if (normalized.includes("expense")) {
      return "duplicate_possible:expense";
    }
    if (normalized.includes("fixed asset")) {
      return "duplicate_possible:fixed_asset";
    }
  }

  const fieldFromMessage = fieldKey ?? inferFieldKeyPrefix(message, importType);
  if (fieldFromMessage && normalized.startsWith(`${fieldFromMessage.toLowerCase()}:`)) {
    return `field_message:${fieldFromMessage}`;
  }

  return `legacy:${message.slice(0, 120)}`;
}

function inferFieldKeyPrefix(
  message: string,
  importType: BulkImportType,
): string | null {
  const match = /^([a-z0-9_]+):/i.exec(message.trim());
  if (!match) {
    return null;
  }
  const key = match[1];
  return getBulkImportTargetField(importType, key) ? key : null;
}
