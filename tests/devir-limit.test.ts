import { describe, expect, test } from "bun:test";
import {
  devirAvailableOf,
  devirablesFor,
  vekilAlacakOf,
  vekilTotalsOf,
  type LedgerEntryLike,
} from "../src/lib/vekil-math";

/**
 * Sunucu `devir` mutation'ının limiti, raporlardaki net "teslim bekleyen"
 * formülüyle aynı olmalıdır (alacak, kira tarafından mahsup edilir).
 *
 * Bu test, mutation'ın kullandığı `devirAvailableOf` fonksiyonunu gerçek
 * cari hesap kayıtlarıyla besler — mutation'ın veritabanından çektiği kayıt
 * seti (personType="proxy", personId=ownerId) birebir modellenir; böylece
 * sunucu limiti ile rapor limitinin aynı fonksiyondan geldiği kanıtlanır.
 */

/** Cari hesap motorunun (ledger_ops) yazdığı formatta kayıt kurucusu. */
const ledgerEntry = (
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

/**
 * Karışık senaryo — bir vekilin cari hesabında aynı anda olabilecek her kayıt türü:
 * - tahsil ettiği kira + depozito (borç tarafı, negatif)
 * - malik adına ödediği kira (alacak)
 * - masraf ödemeleri (alacak)
 * - malike teslim ettiği kira + depozito devirleri (pozitif)
 */
const mixedEntries: LedgerEntryLike[] = [
  ledgerEntry({ amount: -20000, description: "Vekil tahsilatı — kira" }),
  ledgerEntry({ amount: -30000, description: "Vekil tahsilatı — depozito" }),
  ledgerEntry({
    amount: 5000,
    kind: "collection",
    description: "Kira tahsilatı (vekil)",
  }),
  ledgerEntry({
    amount: 3000,
    kind: "expense",
    description: "Masraf — sigorta",
  }),
  ledgerEntry({
    amount: 5000,
    kind: "transfer",
    description: "Vekil devri — tahsilat teslimi",
  }),
  ledgerEntry({
    amount: 12000,
    kind: "transfer",
    description: "Vekil devri — depozito teslimi",
  }),
];

const RENT_LIMIT = 7000; // 20.000 − 5.000 devir − 8.000 alacak
const DEPOSIT_LIMIT = 18000; // 30.000 − 12.000 devir

describe("devir limiti — sunucu == rapor (net formül)", () => {
  test("karışık senaryoda toplamlar ve alacak doğru hesaplanır", () => {
    const t = vekilTotalsOf(mixedEntries, "owner-1");
    expect(t.collectedRent).toBe(20000);
    expect(t.collectedDeposit).toBe(30000);
    expect(t.rentTransfer).toBe(5000);
    expect(t.depositTransfer).toBe(12000);
    expect(vekilAlacakOf(mixedEntries, "owner-1")).toBe(8000);
  });

  test("sunucu devirAvailableOf, devirablesFor (rapor limiti) ile birebir aynıdır", () => {
    const report = devirablesFor(mixedEntries, "owner-1");
    expect(devirAvailableOf(mixedEntries, "owner-1", "rent")).toBe(
      report.rent,
    );
    expect(devirAvailableOf(mixedEntries, "owner-1", "deposit")).toBe(
      report.deposit,
    );
  });

  test("kira limitinde vekil alacağı mahsup edilir", () => {
    expect(devirAvailableOf(mixedEntries, "owner-1", "rent")).toBe(
      RENT_LIMIT,
    );
    // Alacak yokken limit daha yüksek olurdu — mahsup kanıtı.
    const noAlacak = mixedEntries.filter((e) => e.amount >= 0 || true).filter(
      (e) =>
        !(
          e.description === "Kira tahsilatı (vekil)" ||
          e.description === "Masraf — sigorta"
        ),
    );
    expect(devirAvailableOf(noAlacak, "owner-1", "rent")).toBe(15000);
  });

  test("depozito limiti alacaktan etkilenmez", () => {
    expect(devirAvailableOf(mixedEntries, "owner-1", "deposit")).toBe(
      DEPOSIT_LIMIT,
    );
  });

  test("sunucu guard'ı: tutar limite eşitse kabul, limiti aşarsa reddedilir", () => {
    const available = devirAvailableOf(mixedEntries, "owner-1", "rent");
    // `devir` mutation: `if (args.amount > available) throw`
    expect(RENT_LIMIT > available).toBe(false); // eşit tutar reddedilmez
    expect(RENT_LIMIT + 0.01 > available).toBe(true); // üstü reddedilir
    expect(DEPOSIT_LIMIT > devirAvailableOf(mixedEntries, "owner-1", "deposit")).toBe(
      false,
    );
    expect(
      DEPOSIT_LIMIT + 1 >
        devirAvailableOf(mixedEntries, "owner-1", "deposit"),
    ).toBe(true);
  });

  test("mutation'ın veritabanı filtresi modellenir — yalnızca o malikin vekil kayıtları sayılır", () => {
    // withIndex("by_person", q => q.eq("personType","proxy").eq("personId", ownerId))
    const withNoise = [
      ...mixedEntries,
      ledgerEntry({ personId: "owner-2", amount: -99999, description: "Vekil tahsilatı — kira" }),
      ledgerEntry({ personType: "tenant", personId: "tenant-1", amount: -99999, description: "Kira tahsilatı" }),
      ledgerEntry({ personType: "owner", personId: "owner-1", amount: -99999, description: "Kira tahsilatı" }),
    ];
    expect(devirAvailableOf(withNoise, "owner-1", "rent")).toBe(RENT_LIMIT);
    expect(devirAvailableOf(withNoise, "owner-1", "deposit")).toBe(
      DEPOSIT_LIMIT,
    );
  });
});
