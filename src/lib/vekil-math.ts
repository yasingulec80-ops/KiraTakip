/**
 * Vekil cari hesap matematiği — vekil tahsilat/devir toplamları, vekil alacak,
 * vekil borç ve "teslim bekleyen" net tutarlarının saf uygulaması.
 *
 * Vekil Devir Raporu ve Cari Hesaplar ekranı tarafından kullanılır; tek kaynak
 * olduğu için birim test edilir.
 */
import { transferIsDeposit } from "./ledger-kind";

/** Cari hesap kaydının bu hesaplar için gereken minimum yapısal şekli. */
export interface LedgerEntryLike {
  personType?: string;
  personId: unknown; // Id<"owners"> | Id<"tenants"> | string
  kind?: string;
  amount: number;
  description: string;
  date?: number;
  contractId?: unknown;
}

const idOf = (v: unknown): string => (v == null ? "" : String(v));

/** Kayıt, verilen kişiye ait bir vekil kaydı mı? */
export const isProxyEntryOf = (e: LedgerEntryLike, personId: string): boolean =>
  e.personType === "proxy" && idOf(e.personId) === personId;

/** Vekil tahsilatı mı? ("Vekil tahsilatı — kira/depozito") */
const isVekilCollection = (e: LedgerEntryLike): boolean =>
  e.kind === "collection" && e.description.startsWith("Vekil tahsilatı");

/**
 * Vekilin malikten olan alacağı: vekil adına yapılan ödemeler (vekilin ödediği
 * kira, vekilin ödediği masraflar ve pozitif düzeltmeler). Devir kayıtları
 * alacak değildir — onlar tahsilatın malike teslim edilmesidir.
 */
export const vekilAlacakOf = (
  entries: LedgerEntryLike[],
  personId: string,
): number =>
  entries
    .filter(
      (e) =>
        isProxyEntryOf(e, personId) &&
        e.kind !== "transfer" &&
        e.amount > 0,
    )
    .reduce((sum, e) => sum + e.amount, 0);

export interface VekilTotals {
  collectedRent: number;
  collectedDeposit: number;
  rentTransfer: number;
  depositTransfer: number;
}

/**
 * Vekil kayıtlarının kira/depozito ayrımında brüt toplamları:
 * - collected*: "Vekil tahsilatı" kayıtlarının tutarı (borç tarafı, |amount|)
 * - *Transfer: devir kayıtlarının tutarı (teslim edilen)
 */
export const vekilTotalsOf = (
  entries: LedgerEntryLike[],
  personId: string,
  personType: string = "proxy",
): VekilTotals => {
  const totals: VekilTotals = {
    collectedRent: 0,
    collectedDeposit: 0,
    rentTransfer: 0,
    depositTransfer: 0,
  };
  for (const e of entries) {
    if (e.personType !== personType || idOf(e.personId) !== personId) continue;
    const isDeposit = transferIsDeposit(e.description);
    if (isVekilCollection(e)) {
      if (isDeposit) totals.collectedDeposit += Math.abs(e.amount);
      else totals.collectedRent += Math.abs(e.amount);
    } else if (e.kind === "transfer") {
      if (isDeposit) totals.depositTransfer += e.amount;
      else totals.rentTransfer += e.amount;
    }
  }
  return totals;
};

/** Vekil borç = tahsil edilen kira + depozito toplamı. */
export const vekilBorcOf = (
  entries: LedgerEntryLike[],
  personId: string,
): number => {
  const t = vekilTotalsOf(entries, personId);
  return t.collectedRent + t.collectedDeposit;
};

/**
 * Teslim bekleyen net tutar — vekilin malikten olan alacağı (kira/masraf
 * ödemeleri) düşüldükten sonra teslim edilecek tutar. Negatife düşemez:
 * alacak, eldeki tahsilattan fazlaysa teslim bekleyen 0 kabul edilir.
 */
export const remainingOf = (
  collectedRent: number,
  collectedDeposit: number,
  rentTransfer: number,
  depositTransfer: number,
  vekilAlacak = 0,
): number =>
  collectedRent +
    collectedDeposit -
    rentTransfer -
    depositTransfer -
    vekilAlacak;

/** remainingOf ile aynı formül ama negatif değerleri sıfıra clamp eder (eski davranış). */
export const remainingClamped = (
  collectedRent: number,
  collectedDeposit: number,
  rentTransfer: number,
  depositTransfer: number,
  vekilAlacak = 0,
): number =>
  Math.max(0, remainingOf(collectedRent, collectedDeposit, rentTransfer, depositTransfer, vekilAlacak));

/** Vekilin tahsil edip henüz devretmediği tutarlar (kira / depozito ayrı). */
export const devirablesOf = (
  entries: LedgerEntryLike[],
  personId: string,
): { rent: number; deposit: number } => {
  const t = vekilTotalsOf(entries, personId);
  return {
    rent: Math.max(0, t.collectedRent - t.rentTransfer),
    deposit: Math.max(0, t.collectedDeposit - t.depositTransfer),
  };
};

/** Devir penceresi limiti — alacak, kira tarafından mahsup edilir. */
export const devirablesFor = (
  entries: LedgerEntryLike[],
  personId: string,
): { rent: number; deposit: number } => {
  const t = vekilTotalsOf(entries, personId);
  const alacak = vekilAlacakOf(entries, personId);
  return {
    rent: Math.max(0, t.collectedRent - t.rentTransfer - alacak),
    deposit: Math.max(0, t.collectedDeposit - t.depositTransfer),
  };
};

export type DevirTransferType = "rent" | "deposit";

/**
 * Devir tipi için sunucu limiti — `devir` mutation'ının kullandığı hesap.
 * Alacak, yalnızca kira tarafından mahsup edilir; depozito limiti alacaktan
 * etkilenmez. Raporlardaki net "teslim bekleyen" formülüyle birebir aynıdır.
 */
export const devirAvailableOf = (
  entries: LedgerEntryLike[],
  personId: string,
  transferType: DevirTransferType,
): number => {
  const d = devirablesFor(entries, personId);
  return transferType === "deposit" ? d.deposit : d.rent;
};
