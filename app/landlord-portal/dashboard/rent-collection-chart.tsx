"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type RentTrendPoint = {
  label: string;
  monthKey: string;
  collectedGhs: number;
  dueGhs: number;
};

function formatChartCurrency(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export default function LandlordPortalRentCollectionChart({
  data,
}: {
  data: RentTrendPoint[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis
            tickFormatter={(value) =>
              `${Math.round(Number(value) / 1000)}k`
            }
          />
          <Tooltip
            formatter={(value) => formatChartCurrency(Number(value))}
          />
          <Legend />
          <Bar dataKey="dueGhs" fill="#94a3b8" name="Due" />
          <Bar dataKey="collectedGhs" fill="#0f2744" name="Collected" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
