export type RawMaterialDeletePreview = {
  material_name: string;
  purchase_count: number;
  batch_material_count: number;
  incomplete_batches: Array<{
    batch_number: string;
    remaining_material_count: number;
  }>;
};

export type FinishedProductDeletePreview = {
  product_name: string;
  sale_count: number;
  consumption_count: number;
  stock_movement_count: number;
  batch_count: number;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildRawMaterialDeleteMessage(
  preview: RawMaterialDeletePreview,
): string {
  const parts: string[] = [];

  if (preview.purchase_count > 0) {
    parts.push(pluralize(preview.purchase_count, "purchase record"));
  }

  if (preview.batch_material_count > 0) {
    parts.push(
      pluralize(preview.batch_material_count, "production batch material line"),
    );
  }

  let message = `Deleting '${preview.material_name}' will also permanently delete`;

  if (parts.length === 0) {
    message += " this raw material";
  } else {
    message += ` ${parts.join(" and ")}`;
  }

  message += ". Linked Cash or Accounts Payable postings from purchases will be reversed.";

  if (preview.incomplete_batches.length > 0) {
    const batchLabels = preview.incomplete_batches
      .map((batch) => batch.batch_number)
      .join(", ");
    message += ` Production batch${preview.incomplete_batches.length === 1 ? "" : "es"} ${batchLabels} will be left without this material and become incomplete.`;
  }

  message += " This cannot be undone. Continue?";
  return message;
}

export function buildFinishedProductDeleteMessage(
  preview: FinishedProductDeletePreview,
): string {
  const parts: string[] = [];

  if (preview.sale_count > 0) {
    parts.push(pluralize(preview.sale_count, "product sale"));
  }
  if (preview.consumption_count > 0) {
    parts.push(pluralize(preview.consumption_count, "internal consumption record"));
  }
  if (preview.batch_count > 0) {
    parts.push(pluralize(preview.batch_count, "production batch"));
  }
  if (preview.stock_movement_count > 0) {
    parts.push(pluralize(preview.stock_movement_count, "stock movement"));
  }

  let message = `Deleting '${preview.product_name}' will also permanently delete`;

  if (parts.length === 0) {
    message += " this finished product";
  } else {
    message += ` ${parts.join(", ")}`;
  }

  message +=
    ". Linked COGS, internal-use expense, and stock movement records will be reversed or removed.";
  message += " This cannot be undone. Continue?";
  return message;
}

export function confirmCascadeDelete(message: string): boolean {
  return window.confirm(message);
}
