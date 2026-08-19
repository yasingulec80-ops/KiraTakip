import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { ExpenseCategory } from "./schema";
import { postLedgerEntry } from "./ledger_helpers";
import { accrualPosts, contractMonths, expensePosts, periodKey } from "../lib/ledger-posts";

type Contract = Doc<"contracts">;

export { contractMonths, periodKey };

/**
 * Post the tenant debit / owner credit pair for an accrual.
 * Used both when creating a due accrual and by the daily reconcile cron.
 * type "deposit" writes a distinct "Depozito tahakkuku" description so the
 * cari hesap distinguishes rent from deposit accruals.
 */
export const postAccrualLedger = async (
  ctx: MutationCtx,
  actor: Doc<"users"> | null,
  contract: Contract,
  accrual: { _id: Id<"accruals">; period: string; dueDate: number; amount: number },
  type: "rent" | "deposit" = "rent",
) => {
  const referenceId = accrual._id.toString();

  // Kiracı borçlanır, malik alacaklanır (paylaşılan saf kural).
  for (const post of accrualPosts(contract, accrual, type)) {
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: post.personType,
      personId: post.personId as Id<"owners"> | Id<"tenants">,
      kind: post.kind,
      amount: post.amount,
      description: post.description,
      date: accrual.dueDate,
      referenceId,
    });
  }
};

/**
 * Create one accrual record. Only posts ledger entries once the debt is due
 * (dueDate <= now); future accruals are posted by the daily reconcile cron
 * when their due date arrives. type "deposit" creates the automatic deposit
 * accrual posted when a contract is saved.
 */
export const createAccrualWithLedger = async (
  ctx: MutationCtx,
  actor: Doc<"users"> | null,
  contract: Contract,
  month: { period: string; dueDate: number },
  amount?: number,
  type: "rent" | "deposit" = "rent",
) => {
  // Kontrat başlangıç tarihinden önceki tahakkukları engelle
  if (month.dueDate < contract.startDate) return null;
  const rent = amount ?? contract.rentAmount;
  const accrualId = await ctx.db.insert("accruals", {
    contractId: contract._id,
    propertyId: contract.propertyId,
    period: month.period,
    dueDate: month.dueDate,
    amount: rent,
    type,
    status: "pending",
    createdBy: actor?._id,
  });

  if (month.dueDate <= Date.now()) {
    await postAccrualLedger(ctx, actor, contract, {
      _id: accrualId,
      period: month.period,
      dueDate: month.dueDate,
      amount: rent,
    }, type);
  }

  return accrualId;
};

/**
 * Create a collection record and post ledger entries.
 *
 * Payer (Ödeyen):
 * - "tenant" → tenantId, tenant alacaklanır (+), malik borçlanır (−)
 * - "proxy" → proxyOwnerId (vekilin bağlı olduğu malik), vekil alacaklanır (+), malik borçlanır (−)
 *
 * Tür (collectionType):
 * - "rent" → kira tahsilatı
 * - "deposit" → depozito tahsilatı (kiracı öder, kiracı alacaklanır, malik borçlanır)
 *
 * Tahsilatı yapan vekil (collectedByProxyOwnerId): seçilirse vekil, tahsil ettiği
 * tutarı malike teslim edene dek cari hesabında borç olarak izlenir (−).
 */
export const createCollectionWithLedger = async (
  ctx: MutationCtx,
  actor: Doc<"users">,
  contract: Contract,
  args: {
    accrualId?: Id<"accruals">;
    amount: number;
    date: number;
    paidByType: "tenant" | "proxy";
    tenantId?: Id<"tenants">;
    proxyOwnerId?: Id<"owners">;
    collectionType?: "rent" | "deposit";
    collectedByProxyOwnerId?: Id<"owners">;
    notes?: string;
  },
) => {
  const collectionType = args.collectionType ?? "rent";
  const collectionId = await ctx.db.insert("collections", {
    contractId: contract._id,
    propertyId: contract.propertyId,
    accrualId: args.accrualId,
    amount: args.amount,
    date: args.date,
    paidByType: args.paidByType,
    collectionType,
    tenantId: args.tenantId,
    proxyOwnerId: args.proxyOwnerId,
    collectedByProxyOwnerId: args.collectedByProxyOwnerId,
    notes: args.notes,
    createdBy: actor._id,
  });
  const referenceId = collectionId.toString();

  if (collectionType === "deposit") {
    // Depozito: kiracı öder → kiracı alacaklanır (iadesi hak edilir),
    // malik borçlanır (tahsil edilen depozito elde tutulur).
    const tenantId = args.tenantId ?? contract.tenantId;
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "tenant",
      personId: tenantId,
      kind: "collection",
      amount: args.amount,
      description: "Depozito tahsilatı",
      date: args.date,
      referenceId,
    });
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "owner",
      personId: contract.ownerId,
      kind: "collection",
      amount: -args.amount,
      description: "Depozito tahsilatı",
      date: args.date,
      referenceId,
    });
  } else if (args.paidByType === "proxy" && args.proxyOwnerId) {
    // Vekil ödedi → vekil alacaklanır, malik borçlanır.
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "proxy",
      personId: args.proxyOwnerId,
      ownerId: args.proxyOwnerId,
      kind: "collection",
      amount: args.amount,
      description: "Kira tahsilatı (vekil)",
      date: args.date,
      referenceId,
    });
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "owner",
      personId: contract.ownerId,
      kind: "collection",
      amount: -args.amount,
      description: "Kira tahsilatı (vekil)",
      date: args.date,
      referenceId,
    });
  } else {
    // Kiracı ödedi → kiracı alacaklanır, malik borçlanır.
    const tenantId = args.tenantId ?? contract.tenantId;
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "tenant",
      personId: tenantId,
      kind: "collection",
      amount: args.amount,
      description: "Kira tahsilatı",
      date: args.date,
      referenceId,
    });
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "owner",
      personId: contract.ownerId,
      kind: "collection",
      amount: -args.amount,
      description: "Kira tahsilatı",
      date: args.date,
      referenceId,
    });
  }

  // Tahsilatı yapan vekil: tahsil edilen tutar teslim edilene dek cari hesabında borç.
  if (args.collectedByProxyOwnerId) {
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "proxy",
      personId: args.collectedByProxyOwnerId,
      ownerId: args.collectedByProxyOwnerId,
      kind: "collection",
      amount: -args.amount,
      description:
        collectionType === "deposit"
          ? "Vekil tahsilatı — depozito"
          : "Vekil tahsilatı — kira",
      date: args.date,
      referenceId,
    });
  }

  return collectionId;
};

/**
 * Create an expense record and post the payer's ledger entry.
 * - owner pays → owner borçlanır (−)
 * - tenant pays → tenant alacaklanır (+) (kira hesabına mahsup edilir)
 * - proxy pays → proxy alacaklanır (+), malik borçlanır (−)
 */
export const createExpenseWithLedger = async (
  ctx: MutationCtx,
  actor: Doc<"users">,
  args: {
    propertyId: Id<"properties">;
    contractId?: Id<"contracts">;
    category: ExpenseCategory;
    amount: number;
    date: number;
    paidByType: "owner" | "tenant" | "proxy";
    payerOwnerId?: Id<"owners">;
    payerTenantId?: Id<"tenants">;
    description: string;
  },
) => {
  const expenseId = await ctx.db.insert("expenses", {
    propertyId: args.propertyId,
    contractId: args.contractId,
    category: args.category,
    amount: args.amount,
    date: args.date,
    paidByType: args.paidByType,
    payerOwnerId: args.payerOwnerId,
    payerTenantId: args.payerTenantId,
    description: args.description,
    createdBy: actor._id,
  });
  const referenceId = expenseId.toString();

  // Ödeyen sınıflandırması paylaşılan saf kuraldan gelir (owner/proxy/tenant).
  for (const post of expensePosts(args)) {
    await postLedgerEntry(ctx, actor, {
      propertyId: args.propertyId,
      contractId: args.contractId,
      personType: post.personType,
      personId: post.personId as Id<"owners"> | Id<"tenants">,
      ownerId: post.ownerId as Id<"owners"> | undefined,
      kind: post.kind,
      amount: post.amount,
      description: post.description,
      date: args.date,
      referenceId,
    });
  }

  return expenseId;
};
