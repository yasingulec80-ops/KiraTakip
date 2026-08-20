import { describe, expect, test } from "bun:test";
import {
  depositCollectedOf,
  depositDisposalOf,
  depositHeldOf,
  depositRemainingOf,
  depositStatusOf,
  depositTotalsOf,
} from "../src/lib/deposit-math";

const contract = (id: string, depositAmount: number, extra = {}) => ({
  _id: id,
  depositAmount,
  ...extra,
});

const collection = (
  contractId: string,
  amount: number,
  collectionType = "deposit",
) => ({ contractId, amount, collectionType });

const entry = (contractId: string, kind: string, amount: number) => ({
  contractId,
  kind,
  amount,
});

describe("depositCollectedOf", () => {
  test("yalnızca depozito türündeki tahsilatları toplar", () => {
    const rows = [
      collection("c1", 10_000, "deposit"),
      collection("c1", 5_000, "rent"),
      collection("c2", 20_000, "deposit"),
      { contractId: "c1", amount: 2_500, collectionType: undefined },
    ];
    expect(depositCollectedOf(rows, "c1")).toBe(10_000);
    expect(depositCollectedOf(rows, "c2")).toBe(20_000);
  });
});

describe("depositDisposalOf", () => {
  test("iade / malike ödeme / mahsup kalemlerini ayırır", () => {
    const rows = [
      entry("c1", "depositReturn", 3_000),
      entry("c1", "depositReturn", -1_000), // borç tarafı sayılmaz
      entry("c1", "depositOwnerPayment", 4_000),
      entry("c1", "depositWriteOff", 2_000),
      entry("c1", "collection", 9_000),
      entry("c2", "depositReturn", 9_000),
    ];
    expect(depositDisposalOf(rows, "c1")).toEqual({
      returned: 3_000,
      paidToOwner: 4_000,
      writtenOff: 2_000,
    });
  });
});

describe("depositHeldOf", () => {
  test("elde tutulan = tahsil edilen − dağıtılan; negatife düşmez", () => {
    expect(
      depositHeldOf(20_000, { returned: 5_000, paidToOwner: 2_000, writtenOff: 1_000 }),
    ).toBe(12_000);
    expect(
      depositHeldOf(5_000, { returned: 5_000, paidToOwner: 0, writtenOff: 0 }),
    ).toBe(0);
    expect(
      depositHeldOf(1_000, { returned: 0, paidToOwner: 0, writtenOff: 5_000 }),
    ).toBe(0);
  });
});

describe("depositRemainingOf", () => {
  test("sözleşme tutarından tahsil edileni düşer", () => {
    expect(depositRemainingOf(contract("c", 30_000), 12_000)).toBe(18_000);
    expect(depositRemainingOf(contract("c", 30_000), 30_000)).toBe(0);
  });
});

describe("depositStatusOf", () => {
  test("ödeme bekleyen: hiç tahsilat yoksa", () => {
    expect(
      depositStatusOf(contract("c", 10_000), 0, { returned: 0, paidToOwner: 0, writtenOff: 0 }),
    ).toBe("pending");
  });

  test("tahsil edilip elde tutulan: tam tahsilat", () => {
    expect(
      depositStatusOf(contract("c", 10_000), 10_000, { returned: 0, paidToOwner: 0, writtenOff: 0 }),
    ).toBe("paid");
  });

  test("kısmen tahsil edilen", () => {
    expect(
      depositStatusOf(contract("c", 10_000), 4_000, { returned: 0, paidToOwner: 0, writtenOff: 0 }),
    ).toBe("partial");
  });

  test("dağıtım tamamlanınca returned", () => {
    expect(
      depositStatusOf(contract("c", 10_000), 10_000, { returned: 10_000, paidToOwner: 0, writtenOff: 0 }),
    ).toBe("returned");
    expect(
      depositStatusOf(contract("c", 10_000, { depositReturnedAt: 123 }), 10_000, {
        returned: 0,
        paidToOwner: 0,
        writtenOff: 0,
      }),
    ).toBe("returned");
  });
});

describe("depositTotalsOf", () => {
  test("elde tutulan yalnızca tahsilatı yapılan kısmı içerir; ödeme bekleyen ayrı sayılır", () => {
    const contracts = [
      contract("c1", 20_000), // tamamen tahsil edildi, elde tutuluyor
      contract("c2", 15_000), // kısmen tahsil edildi (5.000), 10.000 bekliyor
      contract("c3", 12_000), // hiç tahsil edilmedi → tamamı bekliyor
      contract("c4", 30_000), // tahsil edildi, sonra iade edildi
      contract("c5", 0), // depozitosuz kontrat — toplamlara girmez
    ];
    const collections = [
      collection("c1", 20_000),
      collection("c2", 5_000),
      collection("c4", 30_000),
      collection("c5", 0),
    ];
    const entries = [entry("c4", "depositReturn", 30_000)];

    const totals = depositTotalsOf(contracts, collections, entries);
    expect(totals.total).toBe(77_000);
    // Elde tutulan: c1 (20.000) + c2 (5.000) — c4 iade edildi, c3 hiç tahsil edilmedi.
    expect(totals.held).toBe(25_000);
    expect(totals.heldCount).toBe(2);
    // Ödeme bekleyen: c2 kalan 10.000 + c3 12.000 — c4 iade edildiği için sayılmaz.
    expect(totals.pending).toBe(22_000);
    expect(totals.pendingCount).toBe(2);
    expect(totals.returned).toBe(30_000);
    expect(totals.paidToOwner).toBe(0);
    expect(totals.writtenOff).toBe(0);
  });

  test("malike ödeme ve mahsup dağıtım tarafına girer, elde tutulanı düşürür", () => {
    const contracts = [contract("c1", 20_000)];
    const collections = [collection("c1", 20_000)];
    const entries = [
      entry("c1", "depositOwnerPayment", 12_000),
      entry("c1", "depositWriteOff", 3_000),
    ];
    const totals = depositTotalsOf(contracts, collections, entries);
    expect(totals.held).toBe(5_000);
    expect(totals.paidToOwner).toBe(12_000);
    expect(totals.writtenOff).toBe(3_000);
    expect(totals.pending).toBe(0);
  });

  test("kontratsız depozito devri (transfer) malike teslim edilene eklenir", () => {
    const contracts = [contract("c1", 20_000)];
    const collections = [collection("c1", 20_000)];
    const entries = [
      // Kontrata bağlı depositOwnerPayment
      entry("c1", "depositOwnerPayment", 5_000),
      // Kontratsız depozito devri (vekil devri)
      { contractId: undefined, kind: "transfer", amount: 10_000, description: "Vekil devri — depozito teslimi" },
      // Kontratsız kira devri — depozito sayılmaz
      { contractId: undefined, kind: "transfer", amount: 8_000, description: "Vekil devri — tahsilat teslimi" },
    ];
    const totals = depositTotalsOf(contracts, collections, entries);
    // 5.000 (depositOwnerPayment) + 10.000 (contractless deposit transfer) = 15.000
    expect(totals.paidToOwner).toBe(15_000);
    expect(totals.held).toBe(5_000); // 20.000 - 5.000 - 10.000 = 5.000
  });
});
