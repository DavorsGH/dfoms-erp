export type FixedAssetEntry = {
  asset_id: string;
  asset_name: string;
  asset_category: string;
  purchase_date: string;
  original_cost: number;
  quantity: number;
  total_cost: number;
  useful_life_years: number;
  depreciation_method: string;
  annual_depreciation: number;
  accumulated_depreciation: number | null;
  net_book_value: number | null;
  location: string;
  notes: string | null;
};

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function calculateTotalCost(
  originalCost: number,
  quantity: number,
): number {
  return originalCost * quantity;
}

export function calculateAnnualDepreciationRate(
  usefulLifeYears: number,
): number {
  return 1 / usefulLifeYears;
}

export function calculateAnnualDepreciation(
  totalCost: number,
  usefulLifeYears: number,
): number {
  return totalCost / usefulLifeYears;
}

export function calculateYearsElapsed(
  purchaseDate: string,
  referenceDate = new Date(),
): number {
  const purchaseYear = new Date(purchaseDate).getFullYear();
  const currentYear = referenceDate.getFullYear();

  return Math.max(currentYear - purchaseYear, 0);
}

export function calculateAccumulatedDepreciation(
  annualDepreciation: number,
  purchaseDate: string,
  referenceDate = new Date(),
): number {
  const yearsElapsed = calculateYearsElapsed(purchaseDate, referenceDate);

  return annualDepreciation * yearsElapsed;
}

export function calculateNetBookValue(
  totalCost: number,
  accumulatedDepreciation: number,
): number {
  return Math.max(totalCost - accumulatedDepreciation, 0);
}

export function normalizeDepreciationMethod(
  depreciationMethod: string | null | undefined,
): string {
  return (depreciationMethod ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ");
}

export function isReducingBalanceMethod(
  depreciationMethod: string | null | undefined,
): boolean {
  return (
    normalizeDepreciationMethod(depreciationMethod) === "reducing balance"
  );
}

function calculateStraightLineDepreciation(
  totalCost: number,
  usefulLifeYears: number,
  purchaseDate: string,
  referenceDate: Date,
) {
  const annualDepreciationRate =
    calculateAnnualDepreciationRate(usefulLifeYears);
  const annualDepreciation = calculateAnnualDepreciation(
    totalCost,
    usefulLifeYears,
  );
  const accumulatedDepreciation = calculateAccumulatedDepreciation(
    annualDepreciation,
    purchaseDate,
    referenceDate,
  );
  const netBookValue = calculateNetBookValue(
    totalCost,
    accumulatedDepreciation,
  );

  return {
    annualDepreciationRate,
    annualDepreciation,
    accumulatedDepreciation,
    netBookValue,
  };
}

function calculateReducingBalanceDepreciation(
  totalCost: number,
  usefulLifeYears: number,
  purchaseDate: string,
  referenceDate: Date,
) {
  const rate = calculateAnnualDepreciationRate(usefulLifeYears);
  const yearsElapsed = calculateYearsElapsed(purchaseDate, referenceDate);

  if (rate >= 1) {
    if (yearsElapsed >= 1) {
      return {
        annualDepreciationRate: rate,
        annualDepreciation: yearsElapsed === 1 ? totalCost : 0,
        accumulatedDepreciation: totalCost,
        netBookValue: 0,
      };
    }

    return {
      annualDepreciationRate: rate,
      annualDepreciation: totalCost * rate,
      accumulatedDepreciation: 0,
      netBookValue: totalCost,
    };
  }

  const netBookValue = Math.max(totalCost * (1 - rate) ** yearsElapsed, 0);
  const accumulatedDepreciation = totalCost - netBookValue;
  const netBookValueAtStartOfYear =
    yearsElapsed === 0
      ? totalCost
      : totalCost * (1 - rate) ** (yearsElapsed - 1);
  const annualDepreciation = netBookValueAtStartOfYear * rate;

  return {
    annualDepreciationRate: rate,
    annualDepreciation,
    accumulatedDepreciation,
    netBookValue,
  };
}

export function generateNextAssetId(existingIds: string[]): string {
  const numbers = existingIds.map((id) => {
    const match = id.match(/^DF(\d+)$/i);
    return match ? Number.parseInt(match[1], 10) : 0;
  });
  const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;

  return `DF${String(maxNumber + 1).padStart(4, "0")}`;
}

export function getAssetCalculations(
  originalCost: number,
  quantity: number,
  usefulLifeYears: number,
  purchaseDate: string,
  depreciationMethod: string,
  referenceDate = new Date(),
) {
  const totalCost = calculateTotalCost(
    Number(originalCost) || 0,
    Number(quantity) || 0,
  );
  const lifeYears = Number(usefulLifeYears);

  if (!purchaseDate || !Number.isFinite(lifeYears) || lifeYears <= 0) {
    return {
      totalCost,
      annualDepreciationRate: 0,
      annualDepreciation: 0,
      accumulatedDepreciation: 0,
      netBookValue: totalCost,
    };
  }

  const depreciation = isReducingBalanceMethod(depreciationMethod)
    ? calculateReducingBalanceDepreciation(
        totalCost,
        lifeYears,
        purchaseDate,
        referenceDate,
      )
    : calculateStraightLineDepreciation(
        totalCost,
        lifeYears,
        purchaseDate,
        referenceDate,
      );

  return {
    totalCost,
    ...depreciation,
  };
}
