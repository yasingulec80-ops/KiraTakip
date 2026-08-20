import { describe, expect, it } from "bun:test";
import {
  vekilAlacakOf,
  vekilTotalsOf,
  vekilBorcOf,
  remainingOf,
  remainingClamped,
  devirablesOf,
  devirablesFor,
  devirAvailableOf,
  type LedgerEntryLike,
} from "../src/lib/vekil-math";

/** Helper: build a minimal ledger entry. */
const e = (
  overrides: Partial<LedgerEntryLike> & { amount: number; description: string },
): LedgerEntryLike => ({
  personType: "proxy",
  personId: "owner-1",
  kind: "collection",
  ...overrides,
});

describe("vekilAlacakOf", () => {
  it("sums positive non-transfer proxy entries", () => {
    const entries = [
      e({ amount: 5000, kind: "expense", description: "Masraf — boya" }),
      e({ amount: 3000, kind: "expense", description: "Masraf — bakım" }),
      e({ amount: -2000, kind: "expense", description: "Masraf — iade" }),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(8000);
  });

  it("excludes transfer entries", () => {
    const entries = [
      e({ amount: 5000, kind: "expense", description: "Masraf — boya" }),
      e({ amount: 3000, kind: "transfer", description: "Vekil devri — tahsilat teslimi" }),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(5000);
  });

  it("excludes entries from other proxies", () => {
    const entries = [
      e({ amount: 5000, kind: "expense", description: "test" }),
      e({ amount: 7000, personId: "owner-2", kind: "expense", description: "test" }),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(5000);
  });

  it("returns 0 for empty entries", () => {
    expect(vekilAlacakOf([], "owner-1")).toBe(0);
  });
});

describe("vekilTotalsOf", () => {
  it("computes rent collection totals", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — kira", amount: -10000 }),
      e({ description: "Vekil tahsilatı — kira", amount: -5000 }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.collectedRent).toBe(15000);
    expect(t.collectedDeposit).toBe(0);
    expect(t.rentTransfer).toBe(0);
    expect(t.depositTransfer).toBe(0);
  });

  it("computes deposit collection totals", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — depozito", amount: -50000 }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.collectedDeposit).toBe(50000);
    expect(t.collectedRent).toBe(0);
  });

  it("computes rent transfer totals", () => {
    const entries = [
      e({ kind: "transfer", description: "Vekil devri — tahsilat teslimi", amount: 8000 }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.rentTransfer).toBe(8000);
  });

  it("computes deposit transfer totals", () => {
    const entries = [
      e({ kind: "transfer", description: "Vekil devri — depozito teslimi", amount: 20000 }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.depositTransfer).toBe(20000);
  });

  it("ignores non-proxy entries", () => {
    const entries = [
      e({ personType: "tenant", description: "Vekil tahsilatı — kira", amount: -10000 }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.collectedRent).toBe(0);
  });

  it("ignores entries for other proxies", () => {
    const entries = [
      e({ personId: "owner-2", description: "Vekil tahsilatı — kira", amount: -10000 }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.collectedRent).toBe(0);
  });
});

describe("vekilBorcOf", () => {
  it("returns collected rent + deposit", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — kira", amount: -10000 }),
      e({ description: "Vekil tahsilatı — depozito", amount: -30000 }),
    ];
    expect(vekilBorcOf(entries, "owner-1")).toBe(40000);
  });
});

describe("remainingOf", () => {
  it("basic remaining = collected - transferred - alacak", () => {
    expect(remainingOf(50000, 0, 20000, 0, 5000)).toBe(25000);
  });

  it("can be negative (over-delivered)", () => {
    expect(remainingOf(10000, 0, 15000, 0, 0)).toBe(-5000);
  });

  it("accounts for deposit", () => {
    expect(remainingOf(30000, 20000, 10000, 5000, 2000)).toBe(33000);
  });

  it("zero with no activity", () => {
    expect(remainingOf(0, 0, 0, 0, 0)).toBe(0);
  });
});

describe("remainingClamped", () => {
  it("clamps negative values to 0", () => {
    expect(remainingClamped(10000, 0, 15000, 0, 0)).toBe(0);
  });

  it("returns positive values unchanged", () => {
    expect(remainingClamped(50000, 0, 20000, 0, 5000)).toBe(25000);
  });
});

describe("devirablesOf", () => {
  it("raw devirables without alacak deduction", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — kira", amount: -50000 }),
      e({ kind: "transfer", description: "Vekil devri — tahsilat teslimi", amount: 20000 }),
    ];
    const d = devirablesOf(entries, "owner-1");
    expect(d.rent).toBe(30000);
    expect(d.deposit).toBe(0);
  });

  it("deposit devirables", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — depozito", amount: -100000 }),
      e({ kind: "transfer", description: "Vekil devri — depozito teslimi", amount: 40000 }),
    ];
    const d = devirablesOf(entries, "owner-1");
    expect(d.deposit).toBe(60000);
  });

  it("never negative", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — kira", amount: -10000 }),
      e({ kind: "transfer", description: "Vekil devri — tahsilat teslimi", amount: 15000 }),
    ];
    const d = devirablesOf(entries, "owner-1");
    expect(d.rent).toBe(0);
  });
});

describe("devirablesFor", () => {
  it("deducts alacak from rent", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — kira", amount: -50000 }),
      e({ kind: "expense", description: "Masraf — boya", amount: 10000 }),
    ];
    const d = devirablesFor(entries, "owner-1");
    expect(d.rent).toBe(40000); // 50000 - 0 transfers - 10000 alacak
  });

  it("alacak does not affect deposit", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — depozito", amount: -100000 }),
      e({ kind: "expense", description: "Masraf — boya", amount: 20000 }),
    ];
    const d = devirablesFor(entries, "owner-1");
    expect(d.deposit).toBe(100000); // alacak does NOT reduce deposit
  });

  it("combined scenario", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — kira", amount: -80000 }),
      e({ description: "Vekil tahsilatı — depozito", amount: -50000 }),
      e({ kind: "transfer", description: "Vekil devri — tahsilat teslimi", amount: 30000 }),
      e({ kind: "expense", description: "Masraf — boya", amount: 15000 }),
    ];
    const d = devirablesFor(entries, "owner-1");
    expect(d.rent).toBe(35000); // 80000 - 30000 - 15000
    expect(d.deposit).toBe(50000); // 50000 - 0
  });
});

describe("devirAvailableOf", () => {
  it("returns rent for rent type", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — kira", amount: -50000 }),
      e({ kind: "transfer", description: "Vekil devri — tahsilat teslimi", amount: 20000 }),
    ];
    expect(devirAvailableOf(entries, "owner-1", "rent")).toBe(30000);
  });

  it("returns deposit for deposit type", () => {
    const entries = [
      e({ description: "Vekil tahsilatı — depozito", amount: -100000 }),
      e({ kind: "transfer", description: "Vekil devri — depozito teslimi", amount: 40000 }),
    ];
    expect(devirAvailableOf(entries, "owner-1", "deposit")).toBe(60000);
  });
});
