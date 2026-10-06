export type ProductionBatchMaterialLineInput = {
  material_id: string;
  quantity_used: string;
};

export type ProductionBatchMaterialLineErrors = {
  material?: string;
  quantity?: string;
};

export type ProductionBatchFormValidationResult =
  | { ok: true; payload: ProductionBatchMaterialPayload[] }
  | {
      ok: false;
      formError?: string;
      lineErrors: Record<number, ProductionBatchMaterialLineErrors>;
    };

export type ProductionBatchMaterialPayload = {
  material_id: string;
  quantity_used: number;
  cost_at_time: number;
};

export function resolveMaterialDisplayName(input: {
  materialId: string;
  materials: Array<{ id: string; material_name: string }>;
}): string {
  const match = input.materials.find((row) => row.id === input.materialId);
  return match?.material_name?.trim() || "This material";
}

export function validateProductionBatchMaterialLines(input: {
  lines: ProductionBatchMaterialLineInput[];
  materials: Array<{
    id: string;
    material_name: string;
    current_stock: number;
    average_cost_per_unit: number | null;
  }>;
  resolveCost: (material: {
    id: string;
    average_cost_per_unit: number | null;
  }) => number | null;
}): ProductionBatchFormValidationResult {
  const lineErrors: Record<number, ProductionBatchMaterialLineErrors> = {};
  const payload: ProductionBatchMaterialPayload[] = [];
  const seenMaterialIds = new Map<string, number>();

  let hasAnyLineValue = false;

  for (let index = 0; index < input.lines.length; index += 1) {
    const line = input.lines[index];
    const materialId = line.material_id.trim();
    const quantityRaw = line.quantity_used.trim();

    if (!materialId && !quantityRaw) {
      continue;
    }

    hasAnyLineValue = true;

    if (!materialId) {
      lineErrors[index] = {
        ...lineErrors[index],
        material: "Select a raw material for this line.",
      };
      continue;
    }

    const duplicateIndex = seenMaterialIds.get(materialId);
    if (duplicateIndex != null) {
      const name = resolveMaterialDisplayName({
        materialId,
        materials: input.materials,
      });
      lineErrors[index] = {
        ...lineErrors[index],
        material: `${name} is listed twice. Combine the quantities into one line.`,
      };
      if (!lineErrors[duplicateIndex]?.material) {
        lineErrors[duplicateIndex] = {
          ...lineErrors[duplicateIndex],
          material: `${name} is listed twice. Combine the quantities into one line.`,
        };
      }
    } else {
      seenMaterialIds.set(materialId, index);
    }

    if (!quantityRaw) {
      lineErrors[index] = {
        ...lineErrors[index],
        quantity: "Enter a quantity greater than zero.",
      };
      continue;
    }

    const quantityUsed = Number.parseFloat(quantityRaw);
    if (!Number.isFinite(quantityUsed) || quantityUsed <= 0) {
      lineErrors[index] = {
        ...lineErrors[index],
        quantity: "Enter a quantity greater than zero.",
      };
      continue;
    }

    const material = input.materials.find((row) => row.id === materialId);
    if (!material) {
      lineErrors[index] = {
        ...lineErrors[index],
        material: "Select a valid raw material for this line.",
      };
      continue;
    }

    if (material.current_stock < quantityUsed) {
      lineErrors[index] = {
        ...lineErrors[index],
        quantity: `Only ${material.current_stock} available in this business.`,
      };
      continue;
    }

    const cost = input.resolveCost(material);
    if (cost == null) {
      lineErrors[index] = {
        ...lineErrors[index],
        material: `No unit cost on file for ${material.material_name} in this business.`,
      };
      continue;
    }

    payload.push({
      material_id: materialId,
      quantity_used: quantityUsed,
      cost_at_time: cost,
    });
  }

  if (Object.keys(lineErrors).length > 0) {
    return { ok: false, lineErrors };
  }

  if (!hasAnyLineValue || payload.length === 0) {
    return {
      ok: false,
      formError: "Add at least one raw material with a quantity used.",
      lineErrors: {},
    };
  }

  return { ok: true, payload };
}
