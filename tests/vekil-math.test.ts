import { describe, expect, test } from "bun:test";
import {
  devirAvailableOf,
  devirablesFor,
  devirablesOf,
  isProxyEntryOf,
  remainingOf,
  vekilAlacakOf,
  vekilBorcOf,
  vekilTotalsOf,
  type LedgerEntryLike,
} from "../src/lib/vekil-math";

const e = (
  overrides: Partial<LedgerEntryLike> & Pick<LedgerEntryLike, "amount" | "description">,
): LedgerEntryLike => ({
  personType: "proxy",
  personId: "owner-1",
  kind: "collection",
  ...overrides,
});

const vekilCollection = (amount: number, description: string): LedgerEntryLike =>
  e({ kind: "collection", amount: -amount, description });

const transfer = (amount: number, description: string): LedgerEntryLike =>
  e({ kind: "transfer", amount, description });

describe("isProxyEntryOf", () => {
  test("yalnızca aynı kişinin vekil kayıtlarını eşleştirir", () => {
    expect(isProxyEntryOf(e({ personId: "owner-1" }), "owner-1")).toBe(true);
    expect(isProxyEntryOf(e({ personId: "owner-2" }), "owner-1")).toBe(false);
    expect(
      isProxyEntryOf(e({ personType: "tenant", personId: "owner-1" }), "owner-1"),
    ).toBe(false);
  });
});

describe("vekilTotalsOf", () => {
  test("kira ve depozito tahsilat/devirlerini ayrı toplar; not depozito sınıflandırmasını bozamaz", () => {
    const entries: LedgerEntryLike[] = [
      vekilCollection(18_500, "Vekil tahsilatı — kira"),
      vekilCollection(10_000, "Vekil tahsilatı — depozito"),
      transfer(8_000, "Vekil devri — tahsilat teslimi · depozito kelimesi notta geçer"),
      transfer(5_000, "Vekil devri — tahsilat teslimi"),
      vekilCollection(4_000, "Vekil tahsilatı — kira · notta depozito yazar"),
    ];
    const totals = vekilTotalsOf(entries, "owner-1");
    // "Vekil tahsilatı — kira · notta depozito yazar" → gövde "Vekil tahsilatı — kira" → kira.
    expect(totals.collectedRent).toBe(22_500);
    expect(totals.collectedDeposit).toBe(10_000);
    // Notta "depozito" geçse de gövde "tahsilat teslimi" → kira devri.
    expect(totals.rentTransfer).toBe(13_000);
    expect(totals.depositTransfer).toBe(0);
  });
});

describe("vekilBorcOf", () => {
  test("borç = tahsil edilen kira + depozito", () => {
    const entries: LedgerEntryLike[] = [
      vekilCollection(18_500, "Vekil tahsilatı — kira"),
      vekilCollection(10_000, "Vekil tahsilatı — depozito"),
      transfer(8_000, "Vekil devri — tahsilat teslimi"),
    ];
    expect(vekilBorcOf(entries, "owner-1")).toBe(28_500);
  });
});

describe("vekilAlacakOf", () => {
  test("devirler hariç pozitif kayıtlar alacaktır", () => {
    const entries: LedgerEntryLike[] = [
      e({ kind: "expense", amount: 5_400, description: "Masraf — tadilat" }),
      e({ kind: "expense", amount: 2_500, description: "Masraf — aidat" }),
      e({ kind: "adjustment", amount: 1_000, description: "Düzeltme" }),
      e({ kind: "expense", amount: -700, description: "Masraf — iade" }),
      transfer(8_000, "Vekil devri — tahsilat teslimi"),
    ];
    expect(vekilAlacakOf(entries, "owner-1")).toBe(8_900);
  });
});

describe("remainingOf", () => {
  test("net teslim bekleyen; alacak düşüldükten sonra negatife düşmez", () => {
    expect(remainingOf(18_500, 10_000, 8_000, 0, 0)).toBe(20_500);
    expect(remainingOf(18_500, 10_000, 18_500, 10_000, 2_000)).toBe(0);
    expect(remainingOf(10_000, 0, 0, 0, 12_000)).toBe(0);
  });
});

describe("devirablesOf / devirablesFor — karışık kira/depozito/alacak senaryosu", () => {
  const mixedEntries: LedgerEntryLike[] = [
    vekilCollection(18_500, "Vekil tahsilatı — kira"),
    vekilCollection(10_000, "Vekil tahsilatı — depozito"),
    vekilCollection(6_000, "Vekil tahsilatı — kira"),
    transfer(5_000, "Vekil devri — tahsilat teslimi"),
    e({ kind: "expense", amount: 4_000, description: "Masraf — tadilat (vekil ödedi)" }),
  ];

  test("devirablesOf alacağı mahsup etmez (brüt)", () => {
    const d = devirablesOf(mixedEntries, "owner-1");
    expect(d.rent).toBe(19_500); // 24.500 tahsil − 5.000 devir
    expect(d.deposit).toBe(10_000);
  });

  test("devirablesFor alacağı yalnızca kira tarafından mahsup eder", () => {
    const d = devirablesFor(mixedEntries, "owner-1");
    expect(d.rent).toBe(15_500); // 19.500 − 4.000 alacak
    expect(d.deposit).toBe(10_000); // depozito alacaktan etkilenmez
  });

  test("sunucu devir limiti (devirAvailableOf) devirablesFor ile birebir eşittir", () => {
    // Bu, ledgers.devir mutation'ının kullandığı hesaptır — raporla senkron kalması gerekir.
    expect(devirAvailableOf(mixedEntries, "owner-1", "rent")).toBe(
      devirablesFor(mixedEntries, "owner-1").rent,
    );
    expect(devirAvailableOf(mixedEntries, "owner-1", "deposit")).toBe(
      devirablesFor(mixedEntries, "owner-1").deposit,
    );
  });

  test("alacak tahsilatı tamamen karşılıyorsa kira devri sıfıra düşer, depozito korunur", () => {
    const entries: LedgerEntryLike[] = [
      vekilCollection(10_000, "Vekil tahsilatı — kira"),
      vekilCollection(12_000, "Vekil tahsilatı — depozito"),
      e({ kind: "expense", amount: 11_000, description: "Masraf — tadilat (vekil ödedi)" }),
    ];
    expect(devirAvailableOf(entries, "owner-1", "rent")).toBe(0);
    expect(devirAvailableOf(entries, "owner-1", "deposit")).toBe(12_000);
  });
});
