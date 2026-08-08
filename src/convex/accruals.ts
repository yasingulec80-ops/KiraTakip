import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getActor, getAuthorizedPropertyIds, requireActor, requirePropertyAccess, deleteLedgerForReference } from "./ledger_helpers";
import { createAccrualWithLedger, periodKey } from "./ledger_ops";

/** Recompute an accrual's status from its linked collections. */
export const refreshAccrualStatus = async (
  ctx: MutationCtx,
  accrualId: Id<"accruals">,
) => {
  const accrual = await ctx.db.get(accrualId);
  if (!accrual) return;
  const collections = await ctx.db
    .query("collections")
    .withIndex("by_accrual", (q) => q.eq("accrualId", accrualId))
    .collect();
  const paid = collections.reduce((sum, c) => sum + c.amount, 0);
  let status: "pending" | "partial" | "paid";
  if (paid >= accrual.amount) status = "paid";
  else if (paid > 0) status = "partial";
  else status = "pending";
  await ctx.db.patch(accrual._id, { status });
};

/** List accruals the user may see (property access). */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];
    const all = await ctx.db.query("accruals").collect();
    const authorized = await getAuthorizedPropertyIds(ctx, user);
    if (authorized === null) return all;
    return all.filter((a) => authorized.has(a.propertyId.toString()));
  },
});

/** Create a manual accrual for a contract (picks an unpaid month automatically). */
export const create = mutation({
  args: {
    contractId: v.id("contracts"),
    amount: v.number(),
    dueDate: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);

    const accrualId = await createAccrualWithLedger(ctx, actor, contract, {
      period: periodKey(args.dueDate),
      dueDate: args.dueDate,
    }, args.amount);
    return accrualId;
  },
});

/** Remove an accrual (admin only). Cleans up ledger entries. */
export const remove = mutation({
  args: { id: v.id("accruals") },
  handler: async (ctx, { id }) => {
    const actor = await requireActor(ctx);
    const accrual = await ctx.db.get(id);
    if (!accrual) throw new ConvexError("Tahakkuk bulunamadı.");
    await requirePropertyAccess(ctx, actor, accrual.propertyId);

    await deleteLedgerForReference(ctx, id.toString());
    await ctx.db.delete(id);
  },
});
