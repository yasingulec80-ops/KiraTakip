/**
 * Depozito matematiği — kontrat bazında tahsil edilen, iade edilen, malike
 * ödenen ve zarara/gidere mahsup edilen tutarlar ile durumun saf uygulaması.
 *
 * "Elde tutulan" yalnızca tahsilatı yapılmış kısımdan hesaplanır; ödeme
 * bekleyen (henüz tahsil edilmemiş) depozitolar elde tutulan sayılmaz.
 * Kontrol paneli (Panel) ve Depozitolar modülü (DepositSection) bu yardımcıları
 * kullanır; tek kaynak olduğu için davranış iki ekranda birebir aynıdır.
 *
 * "Malike ödenen" hem depositOwnerPayment hem de kind:"transfer" (devir)
 * kayıtlarını kapsar — vekil depozito devri yoluyla malike teslim edilen
 * tutarlar da burada görünür.
 */

export interface DepositContractLike {
  _id: unknown;
  depositAmount: number;
  depositStatus?: string | null;
  depositReturnedAt?: number | null;
}

export interface DepositCollectionLike {
  contractId: unknown;
  collectionType?: string | null;
  amount: number;
}

export interface DepositLedgerLike {
  contractId?: unknown;
  kind?: string;
  amount: number;
  description?: string;
}

export interface DepositDisposal {
  returned: number; // kiracıya iade edilen
  paidToOwner: number; // malike ödenen
  writtenOff: number; // zarara/gidere mahsup edilen
}

export type DepositStatus = "pending" | "partial" | "paid" | "returned";

export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  pending: "Ödeme Bekliyor",
  partial: "Kısmen Tahsil Edildi",
  paid: "Tahsil Edildi · Elde Tutuluyor",
  returned: "İade / Dağıtıldı",
};

const idOf = (v: unknown): string => (v == null ? "" : String(v));

/** Açıklamanın depozito devri/açıklaması içerip içermediğini kontrol eder. */
const isDepositDescription = (description?: string): boolean => {
  if (!description) return false;
  const base = description.split(" \u00b7 ")[0].trim();
  return base.toLocaleLowerCase("tr").includes("depozito");
};

/** Kontrat başına tahsil edilen depozito toplamı (yalnızca depozito türündeki tahsilatlar). */
export const depositCollectedOf = (
  collections: DepositCollectionLike[],
  contractId: unknown,
): number =>
  collections
    .filter(
      (c) =>
        idOf(c.contractId) === idOf(contractId) &&
        (c.collectionType ?? "rent") === "deposit",
    )
    .reduce((sum, c) => sum + c.amount, 0);

/** Kontrat başına dağıtılan depozito tutarları (iade / malike ödeme / mahsup). */
export const depositDisposalOf = (
  entries: DepositLedgerLike[],
  contractId: unknown,
): DepositDisposal => {
  const disposal: DepositDisposal = {
    returned: 0,
    paidToOwner: 0,
    writtenOff: 0,
  };
  for (const e of entries) {
    if (idOf(e.contractId) !== idOf(contractId)) continue;
    if (e.kind === "depositReturn" && e.amount > 0) {
      disposal.returned += e.amount;
    } else if (e.kind === "depositOwnerPayment" && e.amount > 0) {
      disposal.paidToOwner += e.amount;
    } else if (e.kind === "depositWriteOff" && e.amount > 0) {
      disposal.writtenOff += e.amount;
    }
  }
  return disposal;
};

/** Elde tutulan tutar = tahsil edilen − dağıtılan (iade + malike ödeme + mahsup). */
export const depositHeldOf = (
  collected: number,
  disposal: DepositDisposal,
): number =>
  Math.max(
    0,
    collected - disposal.returned - disposal.paidToOwner - disposal.writtenOff,
  );

/** Henüz tahsil edilmemiş depozito (sözleşme tutarı − tahsil edilen). */
export const depositRemainingOf = (
  contract: DepositContractLike,
  collected: number,
): number => Math.max(0, contract.depositAmount - collected);

/**
 * Kontratın depozito durumu:
 * - iade edildi / tamamen dağıtıldı → "returned"
 * - hiç tahsilat yok → "pending" (ödeme bekliyor)
 * - tahsilat tamam, elde tutuluyor → "paid"
 * - kısmen tahsil edildi → "partial"
 */
export const depositStatusOf = (
  contract: DepositContractLike,
  collected: number,
  disposal: DepositDisposal,
): DepositStatus => {
  if (contract.depositReturnedAt || contract.depositStatus === "returned") {
    return "returned";
  }
  if (collected <= 0) return "pending";
  if (depositHeldOf(collected, disposal) <= 0) return "returned";
  if (collected >= contract.depositAmount) return "paid";
  return "partial";
};

export interface DepositTotals {
  total: number; // sözleşme bazlı toplam depozito
  held: number; // yalnızca tahsil edilip elde tutulan
  returned: number; // kiracıya iade edilen
  paidToOwner: number; // malike ödenen
  writtenOff: number; // mahsup edilen
  pending: number; // ödeme bekleyen (henüz tahsil edilmemiş)
  heldCount: number; // elde tutulan depozitosu olan kontrat sayısı
  pendingCount: number; // ödeme bekleyen kontrat sayısı
}

/** Tüm kontratlar için depozito özeti. */
export const depositTotalsOf = (
  contracts: DepositContractLike[],
  collections: DepositCollectionLike[],
  entries: DepositLedgerLike[],
): DepositTotals => {
  const totals: DepositTotals = {
    total: 0,
    held: 0,
    returned: 0,
    paidToOwner: 0,
    writtenOff: 0,
    pending: 0,
    heldCount: 0,
    pendingCount: 0,
  };
  for (const c of contracts) {
    if (c.depositAmount <= 0) continue;
    const collected = depositCollectedOf(collections, c._id);
    const disposal = depositDisposalOf(entries, c._id);
    const held = depositHeldOf(collected, disposal);
    const status = depositStatusOf(c, collected, disposal);

    totals.total += c.depositAmount;
    totals.held += held;
    totals.returned += disposal.returned;
    totals.paidToOwner += disposal.paidToOwner;
    totals.writtenOff += disposal.writtenOff;
    if (status !== "returned") {
      totals.pending += depositRemainingOf(c, collected);
      if (depositRemainingOf(c, collected) > 0) totals.pendingCount += 1;
    }
    if (held > 0) totals.heldCount += 1;
  }

  // Kontrata bağlı olmayan depozito devir kayıtları (vekil devri) — toplam
  // malike teslim edilen tutara eklenir. Bu kayıtlar contractId içermez,
  // bu yüzden yukarıdaki döngüde depositDisposalOf tarafından yakalanmaz.
  // Elde tutulan tutardan da düşülür.
  let contractlessDepositTransfer = 0;
  for (const e of entries) {
    if (e.contractId) continue;
    if (e.kind === "transfer" && e.amount > 0 && isDepositDescription(e.description)) {
      contractlessDepositTransfer += e.amount;
    }
  }
  totals.paidToOwner += contractlessDepositTransfer;
  totals.held = Math.max(0, totals.held - contractlessDepositTransfer);

  return totals;
};
