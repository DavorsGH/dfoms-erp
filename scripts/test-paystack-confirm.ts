/**
 * Paystack product-sale confirm: popup success, popup closed, Check payment,
 * nightly reconciliation and the webhook all share one idempotent apply.
 *   npx tsx --conditions=react-server scripts/test-paystack-confirm.ts
 */
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  confirmProductSalePaystackPayment,
  paystackConfirmResponse,
  sweepOpenProductSalePaystackRequests,
  validatePaystackVerification,
  PAYSTACK_NOT_CONFIRMED_MESSAGE,
  type PaystackConfirmDeps,
} from "../utils/paystack-product-sale-confirm";
import {
  interpretPaystackConfirmResponse,
  type PaystackClientConfirmResult,
} from "../utils/paystack-confirm-client";
import { runPaystackPopupWithConfirm } from "../app/dashboard/pos/paystack-inline";
import type { PaymentRequestRow } from "../utils/pos-momo-fulfillment";
import type { LogSystemEventInput } from "../lib/system-event-log";

type VerifyOk = Extract<Awaited<ReturnType<PaystackConfirmDeps["verify"]>>, { ok: true }>;

function makeWorld(options: {
  paystackStatus?: string;
  amountPesewas?: number;
  currency?: string;
  row?: Partial<PaymentRequestRow>;
} = {}) {
  const row: PaymentRequestRow = {
    id: "req-1",
    tenant_id: "tenant-1",
    invoice_no: "DF-PSI-0009",
    income_ids: ["inc-1"],
    paystack_reference: "a5fnj1itpj",
    amount_requested: 25,
    status: "sent",
    cart_snapshot: null,
    payment_method: "Mobile Money",
    ...options.row,
  };
  const world = {
    row,
    paystackStatus: options.paystackStatus ?? "success",
    amountPesewas: options.amountPesewas ?? 2500,
    currency: options.currency ?? "GHS",
    logs: [] as LogSystemEventInput[],
    applyCalls: 0,
    appliedWith: [] as Array<Record<string, unknown>>,
    verifyCalls: 0,
  };
  const deps: Partial<PaystackConfirmDeps> = {
    admin: {} as SupabaseClient,
    verify: async (reference: string) => {
      world.verifyCalls += 1;
      return {
        ok: true,
        status: world.paystackStatus,
        reference,
        amount: world.amountPesewas,
        currency: world.currency,
        paidAt: "2026-10-21T08:00:00.000Z",
        gatewayResponse: null,
        customerEmail: null,
        planCode: null,
        channel: "mobile_money",
        authorizationCode: null,
        authorizationEmail: null,
        authorizationChannel: null,
        authorizationReusable: null,
        metadata: {},
      } satisfies VerifyOk;
    },
    loadRequest: async () => ({ ...world.row }),
    apply: async (data) => {
      world.applyCalls += 1;
      world.appliedWith.push(data);
      if (world.row.status === "paid") {
        return { detail: "already paid", alreadyApplied: true };
      }
      world.row.status = "paid";
      return { detail: "applied" };
    },
    log: async (event) => {
      world.logs.push(event);
    },
  };
  return { world, deps };
}

async function main() {
  // --- Pure gate: amount / currency / reference. ---
  const gate = (overrides: Partial<Parameters<typeof validatePaystackVerification>[0]> = {}) =>
    validatePaystackVerification({
      requestedReference: "ref1",
      storedReference: "ref1",
      verifiedReference: "ref1",
      verifiedAmountPesewas: 2500,
      verifiedCurrency: "GHS",
      requestedAmountGhs: 25,
      ...overrides,
    });
  assert.deepEqual(gate(), { ok: true, amountGhs: 25 });
  assert.equal(gate({ verifiedCurrency: "USD" }).ok, false);
  assert.equal(gate({ verifiedAmountPesewas: 2000 }).ok, false);
  assert.equal(gate({ verifiedAmountPesewas: 3000 }).ok, true, "overpayment is applied");
  assert.equal(gate({ verifiedReference: "other" }).ok, false);
  assert.equal(gate({ requestedReference: "mine", storedReference: "ref1" }).ok, false);
  assert.equal(gate({ verifiedAmountPesewas: null }).ok, false);

  // --- 1. Popup success applies, verified against Paystack, with the verified amount. ---
  {
    const { world, deps } = makeWorld();
    const result = await confirmProductSalePaystackPayment(
      {
        paymentRequestId: "req-1",
        reference: "a5fnj1itpj",
        source: "popup_success",
        tenantId: "tenant-1",
      },
      deps,
    );
    assert.equal(result.outcome, "applied");
    assert.equal(world.verifyCalls, 1);
    assert.equal(world.applyCalls, 1);
    assert.equal(world.appliedWith[0].amount, 2500);
    assert.equal(world.row.status, "paid");
    const steps = world.logs.map((entry) => entry.metadata?.step);
    for (const expected of ["received", "request_loaded", "verify", "validate", "applied"]) {
      assert.ok(steps.includes(expected), `logged step ${expected}`);
    }
    assert.ok(world.logs.every((entry) => entry.eventType === "payment"));
    assert.ok(world.logs.every((entry) => entry.metadata?.source === "popup_success"));
    const http = paystackConfirmResponse(result);
    assert.equal(http.status, 200);
    assert.equal(http.body.ok, true);
    assert.equal(http.body.already_applied, false);
  }

  // --- 2. Idempotent: webhook, popup, Check payment and nightly. First applies, rest already applied. ---
  {
    const { world, deps } = makeWorld();
    // Webhook runs first (same apply function).
    await deps.apply!({ reference: "a5fnj1itpj", amount: 2500 });
    assert.equal(world.row.status, "paid");
    for (const source of [
      "popup_success",
      "popup_closed",
      "check_payment",
      "nightly_reconciliation",
    ] as const) {
      const again = await confirmProductSalePaystackPayment(
        { paymentRequestId: "req-1", reference: "a5fnj1itpj", source, tenantId: "tenant-1" },
        deps,
      );
      assert.equal(again.outcome, "already_applied", `${source} after webhook`);
      assert.equal(paystackConfirmResponse(again).body.already_applied, true);
    }
    assert.equal(world.applyCalls, 1, "no second apply once paid");
    assert.equal(world.verifyCalls, 0, "paid requests are not re-verified");
  }

  for (const [first, second] of [
    ["popup_success", "check_payment"],
    ["check_payment", "nightly_reconciliation"],
    ["nightly_reconciliation", "popup_success"],
    ["popup_closed", "popup_success"],
  ] as const) {
    const { world, deps } = makeWorld();
    const one = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: first, tenantId: "tenant-1" },
      deps,
    );
    const two = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: second, tenantId: "tenant-1" },
      deps,
    );
    assert.equal(one.outcome, "applied", `${first} applies first`);
    assert.equal(two.outcome, "already_applied", `${second} is already applied`);
    assert.equal(world.applyCalls, 1);
  }

  // Race: apply reports alreadyApplied (another path won between load and apply).
  {
    const { deps } = makeWorld();
    const racing: Partial<PaystackConfirmDeps> = {
      ...deps,
      apply: async () => ({ detail: "atomic already applied", alreadyApplied: true }),
    };
    const result = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "check_payment", tenantId: "tenant-1" },
      racing,
    );
    assert.equal(result.outcome, "already_applied");
  }

  // --- 3. Popup closed without success: leave it, tell the user to Check payment. ---
  {
    const { world, deps } = makeWorld({ paystackStatus: "abandoned" });
    const result = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "popup_closed", tenantId: "tenant-1" },
      deps,
    );
    assert.equal(result.outcome, "not_paid");
    assert.equal(world.applyCalls, 0);
    assert.equal(world.row.status, "sent", "request left as sent");
    const http = paystackConfirmResponse(result);
    assert.equal(http.status, 200);
    assert.equal(http.body.ok, false);
    assert.equal(http.body.error, PAYSTACK_NOT_CONFIRMED_MESSAGE);
    assert.equal(
      PAYSTACK_NOT_CONFIRMED_MESSAGE,
      "Payment not confirmed yet. Use Check payment in a moment.",
    );
    // Later, Paystack reports success and Check payment applies it.
    world.paystackStatus = "success";
    const later = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "check_payment", tenantId: "tenant-1" },
      deps,
    );
    assert.equal(later.outcome, "applied");
  }

  // --- 4. Server never trusts the client: mismatches are refused and nothing is applied. ---
  for (const options of [
    { amountPesewas: 1000 },
    { currency: "USD" },
  ]) {
    const { world, deps } = makeWorld(options);
    const result = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "check_payment", tenantId: "tenant-1" },
      deps,
    );
    assert.equal(result.outcome, "mismatch");
    assert.equal(world.applyCalls, 0);
    assert.equal(paystackConfirmResponse(result).status, 409);
  }
  {
    const { world, deps } = makeWorld();
    const result = await confirmProductSalePaystackPayment(
      {
        paymentRequestId: "req-1",
        reference: "forged-reference",
        source: "popup_success",
        tenantId: "tenant-1",
      },
      deps,
    );
    assert.equal(result.outcome, "mismatch", "client reference must match the request");
    assert.equal(world.applyCalls, 0);
  }
  {
    const { world, deps } = makeWorld();
    const result = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "check_payment", tenantId: "other-tenant" },
      deps,
    );
    assert.equal(result.outcome, "forbidden");
    assert.equal(world.applyCalls, 0);
    assert.equal(world.verifyCalls, 0);
  }
  {
    const { deps } = makeWorld();
    const result = await confirmProductSalePaystackPayment(
      { paymentRequestId: "", reference: "", source: "check_payment" },
      deps,
    );
    assert.equal(result.outcome, "error");
  }
  {
    const { world, deps } = makeWorld();
    const result = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "check_payment", tenantId: "tenant-1" },
      {
        ...deps,
        apply: async () => ({ detail: "attention", needsAttention: true }),
      },
    );
    assert.equal(result.outcome, "needs_attention");
    assert.equal(paystackConfirmResponse(result).status, 409);
    assert.equal(world.row.status, "sent");
  }

  // --- 5. Nightly sweep: pending/sent with a reference older than 15 minutes. ---
  {
    const rows = [
      { id: "req-a", tenant_id: "tenant-1", paystack_reference: "ref-a" },
      { id: "req-b", tenant_id: "tenant-1", paystack_reference: "ref-b" },
      { id: "req-c", tenant_id: "tenant-1", paystack_reference: "ref-c" },
    ];
    const calls: Array<[string, ...unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "in", "not", "lt", "gt", "order"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return chain;
      };
    }
    chain.limit = async () => ({ data: rows, error: null });
    const admin = { from: () => chain } as unknown as SupabaseClient;

    const state = new Map<string, { status: string; paystack: string }>([
      ["req-a", { status: "sent", paystack: "success" }],
      ["req-b", { status: "pending", paystack: "abandoned" }],
      ["req-c", { status: "paid", paystack: "success" }],
    ]);
    const applied: string[] = [];
    const now = new Date("2026-10-22T03:00:00.000Z");
    const sweep = await sweepOpenProductSalePaystackRequests({
      admin,
      now,
      log: async () => undefined,
      loadRequest: async (_admin, options) => {
        const id = options.paymentRequestId ?? "";
        const entry = state.get(id);
        if (!entry) {
          return null;
        }
        return {
          id,
          tenant_id: "tenant-1",
          invoice_no: `INV-${id}`,
          income_ids: ["inc"],
          paystack_reference: `ref-${id.slice(-1)}`,
          amount_requested: 25,
          status: entry.status,
          cart_snapshot: null,
          payment_method: "Mobile Money",
        };
      },
      verify: async (reference: string) => {
        const id = `req-${reference.slice(-1)}`;
        return {
          ok: true,
          status: state.get(id)?.paystack ?? "failed",
          reference,
          amount: 2500,
          currency: "GHS",
          paidAt: null,
          gatewayResponse: null,
          customerEmail: null,
          planCode: null,
          channel: "mobile_money",
          authorizationCode: null,
          authorizationEmail: null,
          authorizationChannel: null,
          authorizationReusable: null,
          metadata: {},
        } satisfies VerifyOk;
      },
      apply: async (data) => {
        const meta = data.metadata as { payment_request_id: string };
        applied.push(meta.payment_request_id);
        const entry = state.get(meta.payment_request_id);
        if (entry?.status === "paid") {
          return { detail: "already", alreadyApplied: true };
        }
        if (entry) {
          entry.status = "paid";
        }
        return { detail: "applied" };
      },
    });
    assert.equal(sweep.checked, 3);
    assert.equal(sweep.applied, 1);
    assert.equal(sweep.alreadyApplied, 1);
    assert.equal(sweep.notPaid, 1);
    assert.equal(sweep.failed, 0);
    assert.deepEqual(applied, ["req-a"]);
    const inCall = calls.find((call) => call[0] === "in");
    assert.deepEqual(inCall?.slice(1), ["status", ["pending", "sent"]]);
    const ltCall = calls.find((call) => call[0] === "lt");
    assert.equal(ltCall?.[1], "created_at");
    assert.equal(ltCall?.[2], "2026-10-22T02:45:00.000Z", "15 minute cutoff");
    assert.ok(calls.some((call) => call[0] === "not" && call[1] === "paystack_reference"));
  }

  // --- 6. Client response handling. ---
  assert.equal(
    interpretPaystackConfirmResponse(true, { ok: true, invoice_no: "DF-PSI-1", income_ids: ["a"] }).kind,
    "applied",
  );
  assert.equal(
    interpretPaystackConfirmResponse(true, { ok: true, already_applied: true }).kind,
    "already_applied",
  );
  assert.deepEqual(
    interpretPaystackConfirmResponse(true, { ok: false, not_paid: true, error: "x" }),
    { kind: "not_paid", message: PAYSTACK_NOT_CONFIRMED_MESSAGE },
  );
  assert.equal(interpretPaystackConfirmResponse(false, { error: "boom" }).kind, "error");

  // --- 7. Popup runner: success, close and error all hit confirm; polling is a safety net. ---
  type Callbacks = Parameters<NonNullable<Parameters<typeof runPaystackPopupWithConfirm>[0]["open"]>>[1];
  function popupHarness(confirmResults: PaystackClientConfirmResult[]) {
    const confirmCalls: Array<{ source: string; reference?: string | null }> = [];
    let callbacks: Callbacks | null = null;
    const queue = [...confirmResults];
    return {
      confirmCalls,
      fire: () => callbacks!,
      options: {
        accessCode: "code",
        paymentRequestId: "req-1",
        initReference: "init-ref",
        pollIntervalMs: 0,
        open: async (_code: string, cb: Callbacks) => {
          callbacks = cb;
        },
        confirm: async (input: { source: string; reference?: string | null }) => {
          confirmCalls.push({ source: input.source, reference: input.reference });
          return queue.shift() ?? { kind: "not_paid" as const, message: "x" };
        },
      },
    };
  }
  const appliedResult: PaystackClientConfirmResult = {
    kind: "applied",
    invoiceNo: "DF-PSI-0009",
    incomeIds: ["inc-1"],
    reference: "a5fnj1itpj",
    message: "",
  };
  {
    const harness = popupHarness([appliedResult]);
    const pending = runPaystackPopupWithConfirm(harness.options as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fire().onSuccess?.({ reference: "a5fnj1itpj" });
    const outcome = await pending;
    assert.equal(outcome.status, "paid");
    assert.deepEqual(harness.confirmCalls, [
      { source: "popup_success", reference: "a5fnj1itpj" },
    ]);
  }
  {
    const harness = popupHarness([{ kind: "not_paid", message: "x" }]);
    const pending = runPaystackPopupWithConfirm(harness.options as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fire().onCancel?.();
    const outcome = await pending;
    assert.equal(outcome.status, "not_confirmed");
    assert.equal(
      (outcome as { message: string }).message,
      "Payment not confirmed yet. Use Check payment in a moment.",
    );
    assert.equal(harness.confirmCalls.length, 1, "closed confirms exactly once");
    assert.equal(harness.confirmCalls[0].source, "popup_closed");
  }
  {
    // Closed after the customer actually paid: confirm applies it.
    const harness = popupHarness([appliedResult]);
    const pending = runPaystackPopupWithConfirm(harness.options as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fire().onCancel?.();
    assert.equal((await pending).status, "paid");
  }
  {
    const harness = popupHarness([{ kind: "not_paid", message: "x" }]);
    const pending = runPaystackPopupWithConfirm(harness.options as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fire().onError?.({ message: "Card declined" });
    const outcome = await pending;
    assert.equal(outcome.status, "failed");
    assert.equal((outcome as { message: string }).message, "Card declined");
  }
  {
    // Popup never calls back (localhost): polling finds the payment paid.
    const harness = popupHarness([{ kind: "not_paid", message: "x" }, appliedResult]);
    const outcome = await runPaystackPopupWithConfirm({
      ...(harness.options as never),
      pollIntervalMs: 5,
      pollStartMs: 5,
    });
    assert.equal(outcome.status, "paid");
    assert.ok(harness.confirmCalls.every((call) => call.source === "popup_poll"));
    assert.equal(harness.confirmCalls.length, 2);
  }

  // --- 8. Quiet poll: not-paid polls write no log rows. ---
  {
    const { world, deps } = makeWorld({ paystackStatus: "abandoned" });
    const quiet = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "popup_poll", tenantId: "tenant-1" },
      deps,
    );
    assert.equal(quiet.outcome, "not_paid");
    assert.equal(world.logs.length, 0);
    world.paystackStatus = "success";
    const applied = await confirmProductSalePaystackPayment(
      { paymentRequestId: "req-1", source: "popup_poll", tenantId: "tenant-1" },
      deps,
    );
    assert.equal(applied.outcome, "applied");
    assert.ok(world.logs.length > 0, "an applied poll is logged");
  }

  console.log("paystack confirm ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
