import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getActor, getAuthorizedPropertyIds, requireActor, requirePropertyAccess } from "./ledger_helpers";
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
