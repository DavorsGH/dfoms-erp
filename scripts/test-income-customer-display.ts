/**
 * Customer display for income / product sales prefers names over bare client IDs.
 * Usage: npx tsx scripts/test-income-customer-display.ts
 */
import { getIncomeCustomerDisplayName } from "../app/dashboard/finance/income-register-utils";

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const clients = [
  { client_id: "CLI016", client_name: "University of Ghana Medical Center" },
];

eq(
  getIncomeCustomerDisplayName(
    {
      client_id: "CLI016",
      customer_name: "CLI016",
      client: { client_id: "CLI016", client_name: "CLI016" },
    },
    clients,
  ),
  "University of Ghana Medical Center",
  "lookup wins when join and stored name are only the client id",
);

eq(
  getIncomeCustomerDisplayName(
    {
      client_id: "CLI016",
      customer_name: null,
      client: null,
    },
    clients,
  ),
  "University of Ghana Medical Center",
  "clients list resolves manual sale customer",
);

eq(
  getIncomeCustomerDisplayName(
    {
      client_id: null,
      customer_name: "Walk-in payer",
      client: null,
    },
    [],
  ),
  "Walk-in payer",
  "other payer name when no client id",
);

eq(
  getIncomeCustomerDisplayName(
    {
      client_id: "CLI099",
      customer_name: null,
      client: null,
    },
    [],
  ),
  "CLI099",
  "fallback to client id when no name exists",
);

console.log("PASS income customer display");
