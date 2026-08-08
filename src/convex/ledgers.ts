import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  getActor,
  getAuthorizedPropertyIds,
  postLedgerEntry,
  requireActor,
  requirePropertyAccess,
} from "./ledger_helpers";
import {
  createAccrualWithLedger,
  createCollectionWithLedger,
  createExpenseWithLedger,
  periodKey,
} from "./ledger_ops";
import { ledgerKindValidator, ledgerPersonTypeValidator } from "./schema";
import { refreshAccrualStatus } from "./accruals";

/** List ledger entries the user may see (property access). */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];
    const all = await ctx.db.query("ledgerEntries").collect();
    const authorized = await getAuthorizedPropertyIds(ctx, user);
    if (authorized === null) return all;
    return all.filter((e) => {
      if (!e.propertyId) return true; // genel kayıtlar herkese açık
      return authorized.has(e.propertyId.toString());
    });
  },
});

/** Ledger entries for one person (malik / kiracı / vekil). */
export const byPerson = query({
  args: {
    personType: ledgerPersonTypeValidator,
    personId: v.union(v.id("owners"), v.id("tenants")),
  },
  handler: async (ctx, args) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_person", (q) =>
        q.eq("personType", args.personType).eq("personId", args.personId),
      )
      .order("desc")
      .take(500);
    const authorized = await getAuthorizedPropertyIds(ctx, user);
    if (authorized === null) return entries;
    return entries.filter((e) => {
      if (!e.propertyId) return true;
      return authorized.has(e.propertyId.toString());
    });
  },
});

/**
 * Add a manual entry from the Cari Hesaplar menu.
 * - tahakkuk: creates an accrual record (contract required) + ledger entries
 * - ödeme/tahsilat: creates a collection record (contract required) + ledger entries
 * - masraf: creates an expense record (property required) + ledger entry
 * - düzeltme: a single signed ledger entry
 */
export const createManual = mutation({
  args: {
    personType: ledgerPersonTypeValidator,
    personId: v.union(v.id("owners"), v.id("tenants")),
    kind: ledgerKindValidator,
    amount: v.number(), // pozitif = alacak, negatif = borç
    description: v.string(),
    date: v.number(),
    propertyId: v.optional(v.id("properties")),
    contractId: v.optional(v.id("contracts")),
    category: v.optional(
      v.union(
        v.literal("aidat"),
        v.literal("yatirim"),
        v.literal("sigorta"),
        v.literal("tadilat"),
        v.literal("boya"),
        v.literal("diger"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);

    if (args.kind === "accrual") {
      const contractId = args.contractId;
      if (!contractId) throw new ConvexError("Tahakkuk için kontrat seçilmelidir.");
      const contract = await ctx.db.get(contractId);
      if (!contract) throw new ConvexError("Kontrat bulunamadı.");
      await requirePropertyAccess(ctx, actor, contract.propertyId);
      await createAccrualWithLedger(ctx, actor, contract, {
        period: periodKey(args.date),
        dueDate: args.date,
      }, Math.abs(args.amount));
      return true;
    }

    if (args.kind === "collection") {
      const contractId = args.contractId;
      if (!contractId) throw new ConvexError("Ödeme için kontrat seçilmelidir.");
      const contract = await ctx.db.get(contractId);
      if (!contract) throw new ConvexError("Kontrat bulunamadı.");
      await requirePropertyAccess(ctx, actor, contract.propertyId);

      // En eski ödenmemiş tahakkuka bağla.
      const accruals = await ctx.db
        .query("accruals")
        .withIndex("by_contract", (q) => q.eq("contractId", contractId))
        .collect();
      const linked = await ctx.db.query("collections").collect();
      const paidPerAccrual = new Map<string, number>();
      for (const c of linked) {
        if (!c.accrualId) continue;
        paidPerAccrual.set(
          c.accrualId.toString(),
          (paidPerAccrual.get(c.accrualId.toString()) ?? 0) + c.amount,
        );
      }
      const openAccrual = accruals
        .filter(
          (a) => (paidPerAccrual.get(a._id.toString()) ?? 0) < a.amount,
        )
        .sort((a, b) => a.dueDate - b.dueDate)[0];

      const paidByType =
        args.personType === "tenant" ? "tenant" : "proxy";
      const collectionId = await createCollectionWithLedger(ctx, actor, contract, {
        accrualId: openAccrual?._id,
        amount: Math.abs(args.amount),
        date: args.date,
        paidByType,
        tenantId:
          args.personType === "tenant"
            ? (args.personId as Id<"tenants">)
            : undefined,
        proxyOwnerId:
          args.personType === "proxy"
            ? (args.personId as Id<"owners">)
            : undefined,
        notes: args.description,
      });
      if (openAccrual) {
        await refreshAccrualStatus(ctx, openAccrual._id);
      }
      return collectionId;
    }

    if (args.kind === "expense") {
      const propertyId = args.propertyId;
      if (!propertyId) throw new ConvexError("Masraf için gayrimenkul seçilmelidir.");
      await requirePropertyAccess(ctx, actor, propertyId);
      await createExpenseWithLedger(ctx, actor, {
        propertyId,
        contractId: args.contractId,
        category: args.category ?? "diger",
        amount: Math.abs(args.amount),
        date: args.date,
        paidByType: args.personType,
        payerOwnerId:
          args.personType === "owner" || args.personType === "proxy"
            ? (args.personId as Id<"owners">)
            : undefined,
        payerTenantId:
          args.personType === "tenant"
            ? (args.personId as Id<"tenants">)
            : undefined,
        description: args.description,
      });
      return true;
    }

    // düzeltme — tek kayıt
    await postLedgerEntry(ctx, actor, {
      propertyId: args.propertyId,
      contractId: args.contractId,
      personType: args.personType,
      personId: args.personId,
      ownerId:
        args.personType === "proxy" ? (args.personId as Id<"owners">) : undefined,
      kind: "adjustment",
      amount: args.amount,
      description: args.description,
      date: args.date,
    });
    return true;
  },
});

/**
 * Vekil devri — vekilin tahsil ettiği tutarın malike teslim edilmesi.
 * Vekilin cari hesabındaki borç (tahsil edilen kira/depozito) bu tutar
 * kadar kapatılır (+). Teslim edilebilir tutar, vekilin tahsil ettiği ve
 * henüz devretmediği toplam ile sınırlıdır.
 */
export const devir = mutation({
  args: {
    ownerId: v.id("owners"), // vekilin bağlı olduğu malik
    amount: v.number(),
    date: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const owner = await ctx.db.get(args.ownerId);
    if (!owner) throw new ConvexError("Malik bulunamadı.");
    if (!owner.proxy) {
      throw new ConvexError("Bu malikin kayıtlı bir vekili yok.");
    }
    if (args.amount <= 0) {
      throw new ConvexError("Devir tutarı pozitif olmalıdır.");
    }

    // Vekilin tahsil ettiği ve henüz teslim etmediği tutar.
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_person", (q) =>
        q.eq("personType", "proxy").eq("personId", args.ownerId),
      )
      .collect();
    const outstanding = entries.reduce((sum, e) => {
      if (
        e.kind === "collection" &&
        e.description.startsWith("Vekil tahsilatı")
      ) {
        return sum + Math.abs(e.amount);
      }
      if (e.kind === "transfer") return sum - e.amount;
      return sum;
    }, 0);
    if (args.amount > outstanding) {
      throw new ConvexError(
        `Teslim edilebilir tutar ${outstanding.toLocaleString("tr-TR")} ₺ ile sınırlıdır.`,
      );
    }

    await postLedgerEntry(ctx, actor, {
      personType: "proxy",
      personId: args.ownerId,
      ownerId: args.ownerId,
      kind: "transfer",
      amount: args.amount,
      description: args.note
        ? `Vekil devri — tahsilat teslimi · ${args.note}`
        : "Vekil devri — tahsilat teslimi",
      date: args.date,
    });
    return true;
  },
});

/** Remove a ledger entry (admin only). Manual adjustments only. */
export const removeEntry = mutation({
  args: { id: v.id("ledgerEntries") },
  handler: async (ctx, { id }) => {
    const actor = await requireActor(ctx);
    const entry = await ctx.db.get(id);
    if (!entry) throw new ConvexError("Kayıt bulunamadı.");
    if (entry.propertyId) {
      await requirePropertyAccess(ctx, actor, entry.propertyId);
    }
    await ctx.db.delete(id);
  },
});
