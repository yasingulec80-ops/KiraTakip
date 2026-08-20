import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getActor, getAuthorizedPropertyIds, requireActor, requirePropertyAccess, deleteLedgerForReference } from "./ledger_helpers";
import { createAccrualWithLedger, periodKey, postAccrualLedger } from "./ledger_ops";

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

/**
 * Daily reconcile: post ledger entries for accruals that have become due,
 * and remove entries for accruals whose due date has not arrived yet
 * (vadesi gelmeyen borçlar cari hesaba işlenmez).
 */
export const reconcileAccrualLedgers = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const accruals = await ctx.db.query("accruals").collect();

    const entries = await ctx.db.query("ledgerEntries").collect();
    const byReference = new Map<string, typeof entries>();
    for (const e of entries) {
      if (!e.referenceId) continue;
      const list = byReference.get(e.referenceId) ?? [];
      list.push(e);
      byReference.set(e.referenceId, list);
    }

    let posted = 0;
    let removed = 0;

    for (const accrual of accruals) {
      const contract = await ctx.db.get(accrual.contractId);
      if (!contract) continue;

      const refId = accrual._id.toString();
      const accrualEntries = (byReference.get(refId) ?? []).filter(
        (e) => e.kind === "accrual",
      );

      // Kontrat başlangıç tarihinden önceki tahakkukları temizle
      if (accrual.dueDate < contract.startDate) {
        // Silinen kayıtlar referans Map'ten de düşülsün
        for (const e of accrualEntries) {
          await ctx.db.delete(e._id);
        }
        await ctx.db.delete(accrual._id);
        removed += 1;
        continue;
      }

      // Vade gününü kontrat başlangıç gününe göre düzelt
      // (eski kod her zaman ayın 1'ini kullanıyordu)
      // UTC kullanılır — Convex sunucusu UTC'de çalışır
      const startDay = new Date(contract.startDate).getUTCDate();
      const dueD = new Date(accrual.dueDate);
      if (dueD.getUTCDate() !== startDay) {
        const corrected = new Date(Date.UTC(dueD.getUTCFullYear(), dueD.getUTCMonth(), startDay));
        // Ay taşıması olduysa (ör. 31 → 30 günlük ay) ayın son gününe düş
        if (corrected.getUTCDate() !== startDay) corrected.setUTCDate(0);
        const newDue = corrected.getTime();
        const newPeriod = periodKey(newDue);
        await ctx.db.patch(accrual._id, { dueDate: newDue, period: newPeriod });
        dueD.setTime(newDue);
      }

      // Durumu yenile — tahsilat kayıtlarına göre pending/partial/paid
      await refreshAccrualStatus(ctx, accrual._id);

      if (dueD.getTime() <= now) {
        // Vadesi gelmiş: cari kayıt yoksa kiracı/malik hesabına işle.
        if (accrualEntries.length === 0) {
          await postAccrualLedger(ctx, null, contract, {
            _id: accrual._id,
            period: accrual.period,
            dueDate: dueD.getTime(),
            amount: accrual.amount,
          }, accrual.type ?? "rent");
          posted += 1;
        }
      } else {
        // Vadesi gelmemiş: varsa işlenmiş cari kayıtlarını kaldır.
        for (const e of accrualEntries) {
          await ctx.db.delete(e._id);
          removed += 1;
        }
      }
    }

    return { posted, removed };
  },
});

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
