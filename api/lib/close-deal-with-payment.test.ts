import test from "node:test";
import assert from "node:assert/strict";
import { dealDebt, paymentStatusOf, round2 } from "./close-deal-with-payment.ts";

test("paymentStatusOf: unpaid / partial / paid", () => {
  assert.equal(paymentStatusOf(1000, 0), "unpaid");
  assert.equal(paymentStatusOf(1000, -1), "unpaid");
  assert.equal(paymentStatusOf(1000, 500), "partial");
  assert.equal(paymentStatusOf(1000, 999.995), "paid");
  assert.equal(paymentStatusOf(1000, 1000), "paid");
});

test("dealDebt never negative", () => {
  assert.equal(dealDebt(1000, 400), 600);
  assert.equal(dealDebt(1000, 1000), 0);
  assert.equal(dealDebt(1000, 1200), 0);
});

test("round2", () => {
  assert.equal(round2(10.006), 10.01);
  assert.equal(round2(10.004), 10);
});
