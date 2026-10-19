"use client";

import { useState } from "react";
import {
  getDefaultReportPeriod,
  resolveInitialReportYear,
} from "./report-period-utils";
import {
  formatReportPeriodLabel,
  monthIndexFromMonthNumber,
} from "./finance-reports-utils";

export function useMonthYearSelection(
  availableYears: number[],
  options?: { initialYear?: number; initialMonth?: number },
) {
  const defaults = getDefaultReportPeriod();
  const preferredYear = options?.initialYear ?? defaults.year;
  const preferredMonth = options?.initialMonth ?? defaults.month;
  const [year, setYear] = useState(() =>
    resolveInitialReportYear(availableYears, preferredYear),
  );
  const [month, setMonth] = useState(() =>
    preferredMonth >= 1 && preferredMonth <= 12
      ? preferredMonth
      : defaults.month,
  );
  const monthIndex = monthIndexFromMonthNumber(month);
  const periodLabel = formatReportPeriodLabel(year, month);

  return {
    year,
    month,
    setYear,
    setMonth,
    monthIndex,
    periodLabel,
  };
}
