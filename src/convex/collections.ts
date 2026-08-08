import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getActor, getAuthorizedPropertyIds, requireActor, requirePropertyAccess } from "./ledger_helpers";
import { createCollectionWithLedger } from "./ledger_ops";
import { deleteLedgerForReference } from "./ledger_helpers";
import { refreshAccrualStatus } from "./accruals";

/** List collections the user may see (property access). */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];
    const all = await ctx.db.query("collections").collect();
    const authorized = await getAuthorizedPropertyIds(ctx, user);
    if (authorized === null) return all;
    return all.filter((c) => authorized.has(c.propertyId.toString()));
  },
});

/** Record a rent collection. Posts ledger entries and refreshes accrual status. */
export const create = mutation({
  args: {
    contractId: v.id("contracts"),
    accrualId: v.optional(v.id("accruals")),
    amount: v.number(),
    date: v.number(),
    paidByType: v.optional(v.union(v.literal("tenant"), v.literal("proxy"))),
    collectionType: v.optional(
      v.union(v.literal("rent"), v.literal("deposit")),
    ),
    tenantId: v.optional(v.id("tenants")),
    proxyOwnerId: v.optional(v.id("owners")),
    collectedByProxyOwnerId: v.optional(v.id("owners")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);

    const collectionType = args.collectionType ?? "rent";

    // Depozito tahsilatı tahakkuka bağlanmaz; kira tahsilatında tahakkuk
    // seçilmezse en eski ödenmemiş tahakkuka otomatik bağlanır.
    let accrualId = args.accrualId;
    if (collectionType === "rent" && !accrualId) {
      const accruals = await ctx.db
        .query("accruals")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect();
      const collections = await ctx.db.query("collections").collect();
      const paidPerAccrual = new Map<string, number>();
      for (const c of collections) {
        if (!c.accrualId) continue;
        paidPerAccrual.set(
          c.accrualId.toString(),
          (paidPerAccrual.get(c.accrualId.toString()) ?? 0) + c.amount,
        );
      }
      const openAccrual = accruals
        .filter((a) => (paidPerAccrual.get(a._id.toString()) ?? 0) < a.amount)
        .sort((a, b) => a.dueDate - b.dueDate)[0];
      accrualId = openAccrual?._id;
    }

    const collectionId = await createCollectionWithLedger(ctx, actor, contract, {
      accrualId,
      amount: args.amount,
      date: args.date,
      paidByType: args.paidByType ?? "tenant",
      collectionType,
      tenantId: args.tenantId,
      proxyOwnerId: args.proxyOwnerId,
      collectedByProxyOwnerId: args.collectedByProxyOwnerId,
      notes: args.notes,
    });

    if (accrualId) {
      await refreshAccrualStatus(ctx, accrualId);
    }
    return collectionId;
  },
});

/** Remove a collection (admin only). Cleans up ledger entries and refreshes status. */
export const remove = mutation({
  args: { id: v.id("collections") },
  handler: async (ctx, { id }) => {
    const actor = await requireActor(ctx);
    const collection = await ctx.db.get(id);
    if (!collection) throw new ConvexError("Tahsilat bulunamadı.");
    await requirePropertyAccess(ctx, actor, collection.propertyId);

    const accrualId = collection.accrualId;
    await deleteLedgerForReference(ctx, id.toString());
    await ctx.db.delete(id);
    if (accrualId) {
      await refreshAccrualStatus(ctx, accrualId);
    }
  },
});
