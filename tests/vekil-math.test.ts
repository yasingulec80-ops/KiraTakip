import { describe, expect, test } from "bun:test";
import {
  devirablesFor,
  devirablesOf,
  remainingOf,
  vekilAlacakOf,
  vekilBorcOf,
  vekilTotalsOf,
  type LedgerEntryLike,
} from "../src/lib/vekil-math";

/** Test kaydı kurucusu — personType/personId varsayılanları vekil içindir. */
const entry = (
  over: Partial<LedgerEntryLike> & {
    amount: number;
    description: string;
  },
): LedgerEntryLike => ({
  personType: "proxy",
  personId: "owner-1",
  kind: "collection",
  amount: over.amount,
  description: over.description,
  date: new Date(2026, 7, 1).getTime(),
  ...over,
});

describe("vekilAlacakOf — vekilin malikten alacağı", () => {
  test("vekilin ödediği kira/masraflar ve pozitif düzeltmeler toplanır", () => {
    const entries = [
      entry({ kind: "collection", amount: 15000, description: "Kira tahsilatı (vekil)" }),
      entry({ kind: "expense", amount: 5000, description: "Masraf — tadilat" }),
      entry({ kind: "adjustment", amount: 2000, description: "Düzeltme" }),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(22000);
  });

  test("devir kayıtları alacak sayılmaz (teslim edilen tutardır)", () => {
    const entries = [
      entry({ kind: "collection", amount: 15000, description: "Kira tahsilatı (vekil)" }),
      entry({ kind: "transfer", amount: 15000, description: "Vekil devri — tahsilat teslimi" }),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(15000);
  });

  test("negatif tutarlar (borç) alacak sayılmaz", () => {
    const entries = [
      entry({ kind: "collection", amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ kind: "expense", amount: -1000, description: "Masraf — aidat" }),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(0);
  });

  test("yalnızca o malikin vekil kayıtları sayılır", () => {
    const entries = [
      entry({ amount: 15000, description: "Kira tahsilatı (vekil)" }),
      entry({ personId: "owner-2", amount: 9000, description: "Kira tahsilatı (vekil)" }),
      entry({ personType: "tenant", amount: 3000, description: "Kira tahsilatı" }),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(15000);
  });
});

describe("vekilTotalsOf / vekilBorcOf — tahsil edilen kira + depozito", () => {
  test("kira ve depozito tahsilatları ayrı toplanır", () => {
    const entries = [
      entry({ amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ amount: -30000, description: "Vekil tahsilatı — depozito" }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.collectedRent).toBe(15000);
    expect(t.collectedDeposit).toBe(30000);
    expect(vekilBorcOf(entries, "owner-1")).toBe(45000);
  });

  test("devirler ayrı sütunlara yazılır", () => {
    const entries = [
      entry({ amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ kind: "transfer", amount: 10000, description: "Vekil devri — tahsilat teslimi" }),
      entry({ kind: "transfer", amount: 20000, description: "Vekil devri — depozito teslimi" }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    expect(t.rentTransfer).toBe(10000);
    expect(t.depositTransfer).toBe(20000);
    expect(t.collectedRent).toBe(15000);
  });

  test("vekil dışı kayıtlar (kiracı/other) sayılmaz", () => {
    const entries = [
      entry({ amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ personType: "tenant", amount: -15000, description: "Kira tahsilatı" }),
    ];
    expect(vekilBorcOf(entries, "owner-1")).toBe(15000);
  });
});

describe("remainingOf — teslim bekleyen net tutar", () => {
  test("tahsilat − devir = net", () => {
    expect(remainingOf(15000, 30000, 10000, 20000)).toBe(15000);
  });

  test("vekil alacağı düşülür", () => {
    // 15.000 kira + 30.000 depozito − 10.000 devir − 5.000 alacak
    expect(remainingOf(15000, 30000, 10000, 0, 5000)).toBe(30000);
  });

  test("negatife düşemez — alacak tahsilattan fazlaysa 0", () => {
    expect(remainingOf(5000, 0, 0, 0, 10000)).toBe(0);
    expect(remainingOf(0, 0, 5000, 0)).toBe(0);
  });

  test("tam mahsup 0 verir", () => {
    expect(remainingOf(10000, 0, 10000, 0)).toBe(0);
  });
});

describe("devirablesOf / devirablesFor — devir limitleri", () => {
  test("devirablesOf: tahsil edilen eksi devredilen", () => {
    const entries = [
      entry({ amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ amount: -30000, description: "Vekil tahsilatı — depozito" }),
      entry({ kind: "transfer", amount: 10000, description: "Vekil devri — tahsilat teslimi" }),
    ];
    const d = devirablesOf(entries, "owner-1");
    expect(d.rent).toBe(5000);
    expect(d.deposit).toBe(30000);
  });

  test("devirablesFor: vekil alacağı kira limitinden mahsup edilir", () => {
    const entries = [
      entry({ amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ kind: "collection", amount: 12000, description: "Kira tahsilatı (vekil)" }),
      entry({ kind: "expense", amount: 2000, description: "Masraf — sigorta" }),
    ];
    const d = devirablesFor(entries, "owner-1");
    // alacak 14.000, tahsil edilen kira 15.000 → kira limiti 1.000
    expect(d.rent).toBe(1000);
  });

  test("devirablesFor: alacak tahsilattan fazlaysa kira limiti 0", () => {
    const entries = [
      entry({ amount: -5000, description: "Vekil tahsilatı — kira" }),
      entry({ kind: "expense", amount: 12000, description: "Masraf — tadilat" }),
    ];
    const d = devirablesFor(entries, "owner-1");
    expect(d.rent).toBe(0);
  });

  test("depozito limitine alacak mahsup edilmez", () => {
    const entries = [
      entry({ amount: -30000, description: "Vekil tahsilatı — depozito" }),
      entry({ kind: "expense", amount: 25000, description: "Masraf — boya" }),
    ];
    const d = devirablesFor(entries, "owner-1");
    expect(d.deposit).toBe(30000);
    expect(d.rent).toBe(0);
  });
});

describe("entegrasyon — rapor satırı örneği", () => {
  test("vekil 15.000 kira tahsil etti, 0 devretti, 5.000 alacağı var → teslim bekleyen 10.000", () => {
    const entries = [
      entry({ amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ kind: "expense", amount: 5000, description: "Masraf — sigorta" }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    const alacak = vekilAlacakOf(entries, "owner-1");
    expect(alacak).toBe(5000);
    expect(vekilBorcOf(entries, "owner-1")).toBe(15000);
    expect(
      remainingOf(t.collectedRent, t.collectedDeposit, t.rentTransfer, t.depositTransfer, alacak),
    ).toBe(10000);
  });

  test("vekil 15.000 kira + 30.000 depozito tahsil etti, 15.000 kira devretti, 5.000 alacağı var → 25.000", () => {
    const entries = [
      entry({ amount: -15000, description: "Vekil tahsilatı — kira" }),
      entry({ amount: -30000, description: "Vekil tahsilatı — depozito" }),
      entry({ kind: "transfer", amount: 15000, description: "Vekil devri — tahsilat teslimi" }),
      entry({ kind: "expense", amount: 5000, description: "Masraf — aidat" }),
    ];
    const t = vekilTotalsOf(entries, "owner-1");
    const alacak = vekilAlacakOf(entries, "owner-1");
    expect(vekilBorcOf(entries, "owner-1")).toBe(45000);
    expect(
      remainingOf(t.collectedRent, t.collectedDeposit, t.rentTransfer, t.depositTransfer, alacak),
    ).toBe(25000);
  });
});
