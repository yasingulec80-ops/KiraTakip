import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { ExpenseCategory } from "./schema";
import { postLedgerEntry } from "./ledger_helpers";

type Contract = Doc<"contracts">;

export const periodKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const addMonths = (ts: number, months: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime();
};

/** Monthly accrual rows for the contract's full duration. */
export const contractMonths = (
  contract: Pick<Contract, "startDate" | "durationMonths">,
): { period: string; dueDate: number }[] => {
  const months: { period: string; dueDate: number }[] = [];
  for (let i = 0; i < contract.durationMonths; i++) {
    const dueDate = addMonths(contract.startDate, i);
    months.push({ period: periodKey(dueDate), dueDate });
  }
  return months;
};

/**
 * Post the tenant debit / owner credit pair for an accrual.
 * Used both when creating a due accrual and by the daily reconcile cron.
 */
export const postAccrualLedger = async (
  ctx: MutationCtx,
  actor: Doc<"users"> | null,
  contract: Contract,
  accrual: { _id: Id<"accruals">; period: string; dueDate: number; amount: number },
) => {
  const referenceId = accrual._id.toString();

  // Kiracı borçlanır, malik alacaklanır.
  await postLedgerEntry(ctx, actor, {
    propertyId: contract.propertyId,
    contractId: contract._id,
    personType: "tenant",
    personId: contract.tenantId,
    kind: "accrual",
    amount: -accrual.amount,
    description: `Kira tahakkuku — ${accrual.period}`,
    date: accrual.dueDate,
    referenceId,
  });
  await postLedgerEntry(ctx, actor, {
    propertyId: contract.propertyId,
    contractId: contract._id,
    personType: "owner",
    personId: contract.ownerId,
    kind: "accrual",
    amount: accrual.amount,
    description: `Kira tahakkuku — ${accrual.period}`,
    date: accrual.dueDate,
    referenceId,
  });
};

/**
 * Create one accrual record. Only posts ledger entries once the debt is due
 * (dueDate <= now); future accruals are posted by the daily reconcile cron
 * when their due date arrives.
 */
export const createAccrualWithLedger = async (
  ctx: MutationCtx,
  actor: Doc<"users"> | null,
  contract: Contract,
  month: { period: string; dueDate: number },
  amount?: number,
) => {
  const rent = amount ?? contract.rentAmount;
  const accrualId = await ctx.db.insert("accruals", {
    contractId: contract._id,
    propertyId: contract.propertyId,
    period: month.period,
    dueDate: month.dueDate,
    amount: rent,
    status: "pending",
    createdBy: actor?._id,
  });

  if (month.dueDate <= Date.now()) {
    await postAccrualLedger(ctx, actor, contract, {
      _id: accrualId,
      period: month.period,
      dueDate: month.dueDate,
      amount: rent,
    });
  }

  return accrualId;
};

/**
 * Create a collection record and post ledger entries.
 * payer: "tenant" → tenantId, "proxy" → proxyOwnerId (the owner whose vekil paid).
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
    notes?: string;
  },
) => {
  const collectionId = await ctx.db.insert("collections", {
    contractId: contract._id,
    propertyId: contract.propertyId,
    accrualId: args.accrualId,
    amount: args.amount,
    date: args.date,
    paidByType: args.paidByType,
    tenantId: args.tenantId,
    proxyOwnerId: args.proxyOwnerId,
    notes: args.notes,
    createdBy: actor._id,
  });
  const referenceId = collectionId.toString();

  if (args.paidByType === "proxy" && args.proxyOwnerId) {
    // Vekil tahsil etti → vekil alacaklanır, malik borçlanır.
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
  const label = `Masraf — ${args.description || args.category}`;

  if (args.paidByType === "owner" && args.payerOwnerId) {
    await postLedgerEntry(ctx, actor, {
      propertyId: args.propertyId,
      contractId: args.contractId,
      personType: "owner",
      personId: args.payerOwnerId,
      kind: "expense",
      amount: -args.amount,
      description: label,
      date: args.date,
      referenceId,
    });
  } else if (args.paidByType === "proxy" && args.payerOwnerId) {
    await postLedgerEntry(ctx, actor, {
      propertyId: args.propertyId,
      contractId: args.contractId,
      personType: "proxy",
      personId: args.payerOwnerId,
      ownerId: args.payerOwnerId,
      kind: "expense",
      amount: args.amount,
      description: label,
      date: args.date,
      referenceId,
    });
    await postLedgerEntry(ctx, actor, {
      propertyId: args.propertyId,
      contractId: args.contractId,
      personType: "owner",
      personId: args.payerOwnerId,
      kind: "expense",
      amount: -args.amount,
      description: `${label} (vekil)`,
      date: args.date,
      referenceId,
    });
  } else if (args.paidByType === "tenant" && args.payerTenantId) {
    await postLedgerEntry(ctx, actor, {
      propertyId: args.propertyId,
      contractId: args.contractId,
      personType: "tenant",
      personId: args.payerTenantId,
      kind: "expense",
      amount: args.amount,
      description: label,
      date: args.date,
      referenceId,
    });
  }

  return expenseId;
};
