/**
 * Cari hesap kayıt kuralları — tahakkuk (kira/depozito), masraf ödeyen
 * sınıflandırması ve depozito tahakkuk senkronizasyon kararının saf
 * uygulaması. Convex mutation'ları (ledger_ops / contracts) bu kuralları
 * kullanır; tek kaynak olduğu için birim test edilir.
 */

/** Tahakkuk (kira/depozito) veya masraf cari kayıt taslağı. */
export interface LedgerPostDraft {
  personType: "owner" | "tenant" | "proxy";
  personId: unknown; // Id<"owners"> | Id<"tenants">
  ownerId?: unknown; // yalnızca vekil kayıtlarında
  kind: "accrual" | "expense";
  amount: number; // pozitif = alacak, negatif = borç
  description: string;
}

export const periodKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const addMonths = (ts: number, months: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime();
};

/** Monthly accrual rows for the contract's full duration.
 *  Accruals with dueDate before the contract startDate are excluded. */
export const contractMonths = (
  contract: { startDate: number; durationMonths: number },
): { period: string; dueDate: number }[] => {
  const months: { period: string; dueDate: number }[] = [];
  for (let i = 0; i < contract.durationMonths; i++) {
    const dueDate = addMonths(contract.startDate, i);
    // Kontrat başlangıç tarihinden önceki tahakkukları atla
    if (dueDate < contract.startDate) continue;
    months.push({ period: periodKey(dueDate), dueDate });
  }
  return months;
};

/**
 * Tahakkuk cari kayıtları — kiracı borçlanır (−), malik alacaklanır (+).
 * type "deposit" ayrı bir "Depozito tahakkuku" açıklaması yazar ki cari
 * hesap kira ve depozito tahakkuklarını ayırt edebilsin.
 */
export const accrualPosts = (
  contract: { ownerId: unknown; tenantId: unknown },
  accrual: { period: string; amount: number },
  type: "rent" | "deposit" = "rent",
): LedgerPostDraft[] => {
  const label =
    type === "deposit"
      ? `Depozito tahakkuku — ${accrual.period}`
      : `Kira tahakkuku — ${accrual.period}`;
  return [
    {
      personType: "tenant",
      personId: contract.tenantId,
      kind: "accrual",
      amount: -accrual.amount,
      description: label,
    },
    {
      personType: "owner",
      personId: contract.ownerId,
      kind: "accrual",
      amount: accrual.amount,
      description: label,
    },
  ];
};

/**
 * Masraf cari kayıtları — ödeyenin türüne göre sınıflandırma:
 * - owner öder → owner borçlanır (−)
 * - tenant öder → tenant alacaklanır (+) (kira hesabına mahsup edilir)
 * - proxy öder → proxy alacaklanır (+), malik borçlanır (−, "(vekil)" eki)
 * Ödeyen kimliği eksikse hiçbir kayıt üretilmez.
 */
export const expensePosts = (args: {
  paidByType: "owner" | "tenant" | "proxy";
  payerOwnerId?: unknown;
  payerTenantId?: unknown;
  amount: number;
  description: string;
  category: string;
}): LedgerPostDraft[] => {
  const label = `Masraf — ${args.description || args.category}`;
  if (args.paidByType === "owner" && args.payerOwnerId) {
    return [
      {
        personType: "owner",
        personId: args.payerOwnerId,
        kind: "expense",
        amount: -args.amount,
        description: label,
      },
    ];
  }
  if (args.paidByType === "proxy" && args.payerOwnerId) {
    return [
      {
        personType: "proxy",
        personId: args.payerOwnerId,
        ownerId: args.payerOwnerId,
        kind: "expense",
        amount: args.amount,
        description: label,
      },
      {
        personType: "owner",
        personId: args.payerOwnerId,
        kind: "expense",
        amount: -args.amount,
        description: `${label} (vekil)`,
      },
    ];
  }
  if (args.paidByType === "tenant" && args.payerTenantId) {
    return [
      {
        personType: "tenant",
        personId: args.payerTenantId,
        kind: "expense",
        amount: args.amount,
        description: label,
      },
    ];
  }
  return [];
};

/** Depozito tahakkuk senkronizasyon kararının sonucu. */
export type DepositAccrualDecision =
  | {
      action: "create";
      amount: number;
      period: string;
      dueDate: number;
    }
  | {
      action: "update";
      amount: number;
      period: string;
      dueDate: number;
      /** Cari hesap kayıtları yeniden işlenecek mi (vade gelmişse). */
      shouldPost: boolean;
    }
  | { action: "delete" }
  | { action: "none" };

/**
 * Depozito tahakkukunun kontratla senkronizasyon kararı:
 * - tahakkuk yok + depozito > 0 → oluştur
 * - depozito ≤ 0 → sil
 * - tutar değişti → güncelle (vade gelmişse cari kayıtları yeniden işle)
 * - aksi halde → dokunma
 */
export const depositAccrualDecision = (
  depositAmount: number,
  existing: { amount: number; dueDate: number } | null,
  startDate: number,
  now: number,
): DepositAccrualDecision => {
  if (!existing && depositAmount > 0) {
    return {
      action: "create",
      amount: depositAmount,
      period: periodKey(startDate),
      dueDate: startDate,
    };
  }
  if (!existing) return { action: "none" };
  if (depositAmount <= 0) return { action: "delete" };
  if (existing.amount !== depositAmount) {
    return {
      action: "update",
      amount: depositAmount,
      period: periodKey(startDate),
      dueDate: startDate,
      shouldPost: existing.dueDate <= now || startDate <= now,
    };
  }
  return { action: "none" };
};
