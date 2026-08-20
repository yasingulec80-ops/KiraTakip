import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getActor, getAuthorizedPropertyIds, postLedgerEntry, requireActor, requirePropertyAccess } from "./ledger_helpers";
import { createExpenseWithLedger } from "./ledger_ops";
import { deleteLedgerForReference } from "./ledger_helpers";
import { expenseCategoryValidator } from "./schema";

/** List expenses the user may see (property access). */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];
    const all = await ctx.db.query("expenses").collect();
    const authorized = await getAuthorizedPropertyIds(ctx, user);
    if (authorized === null) return all;
    return all.filter((e) => authorized.has(e.propertyId.toString()));
  },
});

/** Record an expense. Posts the payer's ledger entry. */
export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    contractId: v.optional(v.id("contracts")),
    category: expenseCategoryValidator,
    amount: v.number(),
    date: v.number(),
    paidByType: v.optional(
      v.union(v.literal("owner"), v.literal("tenant"), v.literal("proxy")),
    ),
    payerOwnerId: v.optional(v.id("owners")),
    payerTenantId: v.optional(v.id("tenants")),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    await requirePropertyAccess(ctx, actor, args.propertyId);

    return await createExpenseWithLedger(ctx, actor, {
      propertyId: args.propertyId,
      contractId: args.contractId,
      category: args.category,
      amount: args.amount,
      date: args.date,
      paidByType: args.paidByType ?? "owner",
      payerOwnerId: args.payerOwnerId,
      payerTenantId: args.payerTenantId,
      description: args.description,
    });
  },
});

/** Update an expense (admin only). Replaces old ledger entries. */
export const update = mutation({
  args: {
    id: v.id("expenses"),
    category: expenseCategoryValidator,
    amount: v.number(),
    date: v.number(),
    description: v.string(),
    paidByType: v.optional(
      v.union(v.literal("owner"), v.literal("tenant"), v.literal("proxy")),
    ),
    payerOwnerId: v.optional(v.id("owners")),
    payerTenantId: v.optional(v.id("tenants")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("Masraf bulunamadı.");
    await requirePropertyAccess(ctx, actor, existing.propertyId);

    // Eski cari hesap kayıtlarını sil
    await deleteLedgerForReference(ctx, args.id.toString());

    // Güncelle
    await ctx.db.patch(args.id, {
      category: args.category,
      amount: args.amount,
      date: args.date,
      description: args.description,
      paidByType: args.paidByType,
      payerOwnerId: args.payerOwnerId,
      payerTenantId: args.payerTenantId,
    });

    // Yeni cari hesap kayıtları oluştur — expensePosts ile aynı kural.
    const label = `Masraf — ${args.description || args.category}`;
    const paidByType = args.paidByType ?? "owner";
    if (paidByType === "owner" && args.payerOwnerId) {
      // Malik öder → malik borçlanır (−)
      await postLedgerEntry(ctx, actor, {
        propertyId: existing.propertyId,
        contractId: existing.contractId,
        personType: "owner",
        personId: args.payerOwnerId,
        kind: "expense",
        amount: -args.amount,
        description: label,
        date: args.date,
        referenceId: args.id.toString(),
      });
    } else if (paidByType === "proxy" && args.payerOwnerId) {
      // Vekil öder → vekil alacaklanır (+), malik borçlanır (−)
      await postLedgerEntry(ctx, actor, {
        propertyId: existing.propertyId,
        contractId: existing.contractId,
        personType: "proxy",
        personId: args.payerOwnerId,
        ownerId: args.payerOwnerId,
        kind: "expense",
        amount: args.amount,
        description: label,
        date: args.date,
        referenceId: args.id.toString(),
      });
      await postLedgerEntry(ctx, actor, {
        propertyId: existing.propertyId,
        contractId: existing.contractId,
        personType: "owner",
        personId: args.payerOwnerId,
        kind: "expense",
        amount: -args.amount,
        description: `${label} (vekil)`,
        date: args.date,
        referenceId: args.id.toString(),
      });
    } else if (paidByType === "tenant" && args.payerTenantId) {
      // Kiracı öder → kiracı alacaklanır (+)
      await postLedgerEntry(ctx, actor, {
        propertyId: existing.propertyId,
        contractId: existing.contractId,
        personType: "tenant",
        personId: args.payerTenantId,
        kind: "expense",
        amount: args.amount,
        description: label,
        date: args.date,
        referenceId: args.id.toString(),
      });
    }
  },
});

/** Remove an expense (admin only). Cleans up ledger entries. */
export const remove = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, { id }) => {
    const actor = await requireActor(ctx);
    const expense = await ctx.db.get(id);
    if (!expense) throw new ConvexError("Masraf bulunamadı.");
    await requirePropertyAccess(ctx, actor, expense.propertyId);

    await deleteLedgerForReference(ctx, id.toString());
    await ctx.db.delete(id);
  },
});
