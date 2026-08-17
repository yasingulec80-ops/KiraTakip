import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import {
  postLedgerEntry,
  requireActor,
  requirePropertyAccess,
} from "./ledger_helpers";
import { createCollectionWithLedger } from "./ledger_ops";
import { expenseCategoryValidator } from "./schema";
import {
  depositCollectedOf,
  depositDisposalOf,
  depositHeldOf,
  depositRemainingOf,
} from "../lib/deposit-math";

/**
 * Depozito modülü — kayıt girişi.
 *
 * Kontrat bazında dört işlem desteklenir:
 * - "tahsil"      → kiracı depozitoyu öder (tahsilat + cari: kiracı alacak, malik borç)
 * - "iade"        → depozito kiracıya iade edilir (kiracı borç, malik alacak)
 * - "malikeOdeme" → tahsil edilen depozito malike ödenir (malik alacak)
 * - "mahsup"      → depozito zarara/gidere mahsup edilir (kiracı borç, malik alacak
 *                   + Masraflar modülüne masraf kaydı)
 *
 * İşlem tutarları sınırlıdır: tahsil → sözleşme tutarından kalan; diğerleri →
 * elde tutulan (tahsil edilen − dağıtılan) tutar. "Elde tutulan" yalnızca
 * tahsilatı yapılmış kısmı içerir; ödeme bekleyen depozito buraya girmez.
 */
export const createDepositRecord = mutation({
  args: {
    contractId: v.id("contracts"),
    action: v.union(
      v.literal("tahsil"),
      v.literal("iade"),
      v.literal("malikeOdeme"),
      v.literal("mahsup"),
    ),
    amount: v.number(),
    date: v.number(),
    note: v.optional(v.string()),
    collectedByProxyOwnerId: v.optional(v.id("owners")), // tahsilatı yapan vekil
    category: v.optional(expenseCategoryValidator), // mahsup masraf kalemi
    description: v.optional(v.string()), // mahsup açıklaması
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);
    if (args.amount <= 0) {
      throw new ConvexError("Tutar pozitif olmalıdır.");
    }

    const collections = await ctx.db
      .query("collections")
      .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
      .collect();
    const entries = await ctx.db
      .query("ledgerEntries")
      .filter((q) => q.eq(q.field("contractId"), contract._id))
      .collect();

    const collected = depositCollectedOf(collections, contract._id);
    const disposal = depositDisposalOf(entries, contract._id);
    const held = depositHeldOf(collected, disposal);
    const remaining = depositRemainingOf(contract, collected);

    if (args.action === "tahsil") {
      if (args.amount > remaining) {
        throw new ConvexError(
          `Tahsil edilebilecek depozito ${remaining.toLocaleString("tr-TR")} ₺ ile sınırlıdır.`,
        );
      }
      await createCollectionWithLedger(ctx, actor, contract, {
        collectionType: "deposit",
        amount: args.amount,
        date: args.date,
        paidByType: "tenant",
        tenantId: contract.tenantId,
        collectedByProxyOwnerId: args.collectedByProxyOwnerId,
        notes: args.note,
      });
      return { action: args.action, amount: args.amount };
    }

    if (args.amount > held) {
      throw new ConvexError(
        `Elde tutulan depozito ${held.toLocaleString("tr-TR")} ₺ ile sınırlıdır.`,
      );
    }

    if (args.action === "iade") {
      const referenceId = `${contract._id.toString()}:deposit-iade`;
      const label = args.note ? ` · ${args.note}` : "";
      // Kiracı borçlanır — iade hakkı kapanır; malik alacaklanır — yükümlülük kapanır.
      await postLedgerEntry(ctx, actor, {
        propertyId: contract.propertyId,
        contractId: contract._id,
        personType: "tenant",
        personId: contract.tenantId,
        kind: "depositReturn",
        amount: -args.amount,
        description: `Depozito iadesi${label}`,
        date: args.date,
        referenceId,
      });
      await postLedgerEntry(ctx, actor, {
        propertyId: contract.propertyId,
        contractId: contract._id,
        personType: "owner",
        personId: contract.ownerId,
        kind: "depositReturn",
        amount: args.amount,
        description: `Depozito iadesi${label}`,
        date: args.date,
        referenceId,
      });
      return { action: args.action, amount: args.amount };
    }

    if (args.action === "malikeOdeme") {
      const label = args.note ? ` · ${args.note}` : "";
      // Malik alacaklanır — tahsil edilen depozito malike teslim edilir.
      await postLedgerEntry(ctx, actor, {
        propertyId: contract.propertyId,
        contractId: contract._id,
        personType: "owner",
        personId: contract.ownerId,
        kind: "depositOwnerPayment",
        amount: args.amount,
        description: `Depozito — malike ödeme${label}`,
        date: args.date,
        referenceId: `${contract._id.toString()}:deposit-malik`,
      });
      return { action: args.action, amount: args.amount };
    }

    // mahsup — zarara/gidere mahsup
    const label = args.note || args.description || "gider";
    const referenceId = `${contract._id.toString()}:deposit-mahsup`;
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "tenant",
      personId: contract.tenantId,
      kind: "depositWriteOff",
      amount: -args.amount,
      description: `Depozito — zarara/gidere mahsup · ${label}`,
      date: args.date,
      referenceId,
    });
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "owner",
      personId: contract.ownerId,
      kind: "depositWriteOff",
      amount: args.amount,
      description: `Depozito — zarara/gidere mahsup · ${label}`,
      date: args.date,
      referenceId,
    });
    // Masraflar modülünde görünmesi için masraf kaydı (cari hesap kayıtları
    // yukarıda depozito işlemi olarak atıldı — çift kayıt önlenir).
    await ctx.db.insert("expenses", {
      propertyId: contract.propertyId,
      contractId: contract._id,
      category: args.category ?? "diger",
      amount: args.amount,
      date: args.date,
      paidByType: "tenant",
      payerTenantId: contract.tenantId,
      description: `Depozitodan mahsup · ${label}`,
      createdBy: actor._id,
    });
    return { action: args.action, amount: args.amount };
  },
});
