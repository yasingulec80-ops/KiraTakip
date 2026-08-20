import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getActor, getAuthorizedPropertyIds, postLedgerEntry, requireActor, requirePropertyAccess } from "./ledger_helpers";
import { createCollectionWithLedger } from "./ledger_ops";
import { deleteLedgerForReference } from "./ledger_helpers";
import { refreshAccrualStatus } from "./accruals";
import { sameProxyCollectionConflict } from "../lib/collection-guard";

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
    const paidByType = args.paidByType ?? "tenant";

    // Ödeyen vekil ile tahsilatı yapan aynı vekil olamaz — vekilin
    // cari hesabında borç ve alacağın birbirini götürmesini önler.
    if (
      sameProxyCollectionConflict(
        paidByType,
        args.proxyOwnerId,
        args.collectedByProxyOwnerId,
      )
    ) {
      throw new ConvexError(
        "Ödeyen vekil ile tahsilatı yapan aynı vekil olamaz.",
      );
    }

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
      paidByType,
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

/** Update a collection (admin only). Replaces old ledger entries and refreshes accrual. */
export const update = mutation({
  args: {
    id: v.id("collections"),
    amount: v.number(),
    date: v.number(),
    notes: v.optional(v.string()),
    accrualId: v.optional(v.id("accruals")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("Tahsilat bulunamadı.");
    await requirePropertyAccess(ctx, actor, existing.propertyId);

    const contract = await ctx.db.get(existing.contractId);
    if (!contract) throw new ConvexError("İlişkili kontrat bulunamadı.");

    // Eski cari hesap kayıtlarını sil
    const oldAccrualId = existing.accrualId;
    await deleteLedgerForReference(ctx, args.id.toString());

    // Güncelle
    await ctx.db.patch(args.id, {
      amount: args.amount,
      date: args.date,
      notes: args.notes,
      accrualId: args.accrualId,
    });

    // Yeni cari hesap kayıtları oluştur
    const actorType = existing.collectedByProxyOwnerId ? "proxy" : "office";
    const personType = existing.paidByType === "proxy" ? "proxy" : "tenant";
    const personId =
      personType === "proxy" && existing.proxyOwnerId
        ? existing.proxyOwnerId
        : existing.tenantId;
    if (personId) {
      await postLedgerEntry(ctx, actor, {
        propertyId: existing.propertyId,
        contractId: existing.contractId,
        personType,
        personId,
        kind: "collection",
        amount: -args.amount,
        description: `Tahsilat${existing.collectionType === "deposit" ? " (Depozito)" : ""}${args.notes ? ` · ${args.notes}` : ""}`,
        date: args.date,
        referenceId: args.id.toString(),
      });
      if (actorType === "proxy" && existing.collectedByProxyOwnerId) {
        await postLedgerEntry(ctx, actor, {
          propertyId: existing.propertyId,
          contractId: existing.contractId,
          personType: "proxy",
          personId: existing.collectedByProxyOwnerId,
          kind: "collection",
          amount: args.amount,
          description: `Vekil tahsilatı${existing.collectionType === "deposit" ? " (Depozito)" : ""}${args.notes ? ` · ${args.notes}` : ""}`,
          date: args.date,
          referenceId: args.id.toString(),
        });
      }
    }

    // Yeni tahakkuk durumunu yenile
    const accrualId = args.accrualId ?? oldAccrualId;
    if (accrualId) {
      await refreshAccrualStatus(ctx, accrualId);
    }
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
