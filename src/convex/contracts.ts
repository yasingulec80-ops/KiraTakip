import { ConvexError, v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  ROLES,
  contractStatusValidator,
  depositStatusValidator,
  fixtureValidator,
} from "./schema";
import {
  getActor,
  getAuthorizedPropertyIds,
  postLedgerEntry,
  requireActor,
  requirePropertyAccess,
} from "./ledger_helpers";
import {
  contractMonths,
  createAccrualWithLedger,
} from "./ledger_ops";

const contractArgs = {
  propertyId: v.id("properties"),
  ownerId: v.id("owners"),
  tenantId: v.id("tenants"),
  startDate: v.number(),
  durationMonths: v.number(),
  rentAmount: v.number(),
  depositAmount: v.number(),
  depositStatus: v.optional(depositStatusValidator),
  fixtures: v.optional(v.array(fixtureValidator)),
  notes: v.optional(v.string()),
  status: v.optional(contractStatusValidator),
};

type Contract = Doc<"contracts">;

/** List contracts the current user is authorized to see. */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];

    const all = await ctx.db.query("contracts").collect();
    const authorized = await getAuthorizedPropertyIds(ctx, user);
    if (authorized === null) return all;
    return all.filter((c) => authorized.has(c.propertyId.toString()));
  },
});

/** Create a contract. Automatically generates monthly rent accruals. */
export const create = mutation({
  args: contractArgs,
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    await requirePropertyAccess(ctx, actor, args.propertyId);

    if (args.durationMonths < 1) {
      throw new ConvexError("Kira süresi en az 1 ay olmalıdır.");
    }

    const contractId = await ctx.db.insert("contracts", {
      ...args,
      fixtures: args.fixtures ?? [],
      status: args.status ?? "active",
      createdBy: actor._id,
    });
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError("Kontrat oluşturulamadı.");

    for (const month of contractMonths(contract)) {
      await createAccrualWithLedger(ctx, actor, contract, month);
    }

    return contractId;
  },
});

/** Update a contract. Optionally regenerates missing monthly accruals. */
export const update = mutation({
  args: { id: v.id("contracts"), ...contractArgs },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(args.id);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, args.propertyId);

    const { id, ...data } = args;
    await ctx.db.patch(id, {
      propertyId: data.propertyId,
      ownerId: data.ownerId,
      tenantId: data.tenantId,
      startDate: data.startDate,
      durationMonths: data.durationMonths,
      rentAmount: data.rentAmount,
      depositAmount: data.depositAmount,
      depositStatus: data.depositStatus,
      fixtures: data.fixtures ?? [],
      notes: data.notes,
      status: data.status ?? "active",
    });

    const updated = await ctx.db.get(id);
    if (updated) {
      await generateMissingAccruals(ctx, actor, updated);
    }
  },
});

/** Remove a contract (admin only). Cascades accruals and ledger entries. */
export const remove = mutation({
  args: { id: v.id("contracts") },
  handler: async (ctx, { id }) => {
    const actor = await requireActor(ctx);
    if (actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici kontrat silebilir.");
    }
    const contract = await ctx.db.get(id);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");

    const accruals = await ctx.db
      .query("accruals")
      .withIndex("by_contract", (q) => q.eq("contractId", id))
      .collect();
    for (const accrual of accruals) {
      await ctx.db.delete(accrual._id);
    }
    // Remove ledger entries tied to this contract.
    const entries = await ctx.db
      .query("ledgerEntries")
      .filter((q) => q.eq(q.field("contractId"), id))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    const collections = await ctx.db
      .query("collections")
      .withIndex("by_contract", (q) => q.eq("contractId", id))
      .collect();
    for (const collection of collections) {
      await ctx.db.delete(collection._id);
    }

    await ctx.db.delete(id);
  },
});

/**
 * Mark a contract's deposit as returned, recording date and note.
 *
 * Depozito cari hesaplara işlenmişse iade kaydı da otomatik işlenir:
 * kiracı borçlanır (−, iade hakkı kapanır), malik alacaklanır (+, depozito
 * yükümlülüğü kapanır). Depozitoyu tahsil eden vekil varsa vekilin cari
 * hesabındaki borç da kapatılır (+). Depozito cariye hiç işlenmemişse kayıt
 * atılmaz (yalnızca kontrat üzerinden izlenir).
 */
export const returnDeposit = mutation({
  args: {
    contractId: v.id("contracts"),
    date: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { contractId, date, note }) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);
    await ctx.db.patch(contractId, {
      depositStatus: "returned" as const,
      depositReturnedAt: date,
      depositNote: note,
    });

    // Depozito türündeki tahsilatlar — cari hesaplara işlenen tutarın kaynağı.
    const allCollections = await ctx.db
      .query("collections")
      .withIndex("by_contract", (q) => q.eq("contractId", contractId))
      .collect();
    const depositCollections = allCollections.filter(
      (c) => (c.collectionType ?? "rent") === "deposit",
    );
    const totalCollected = depositCollections.reduce(
      (sum, c) => sum + c.amount,
      0,
    );
    if (totalCollected <= 0) return { entriesPosted: 0 };

    const referenceId = `${contractId.toString()}:deposit-return`;
    let entriesPosted = 0;

    // Kiracı borçlanır — depozito iadesi alınmıştır.
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "tenant",
      personId: contract.tenantId,
      kind: "depositReturn",
      amount: -totalCollected,
      description: "Depozito iadesi",
      date,
      referenceId,
    });
    // Malik alacaklanır — depozito yükümlülüğü kapanır.
    await postLedgerEntry(ctx, actor, {
      propertyId: contract.propertyId,
      contractId: contract._id,
      personType: "owner",
      personId: contract.ownerId,
      kind: "depositReturn",
      amount: totalCollected,
      description: "Depozito iadesi",
      date,
      referenceId,
    });
    entriesPosted += 2;

    // Depozitoyu tahsil eden vekil varsa borcu kapatılır (tahsil ettiği tutar kadar).
    const byVekil = new Map<string, number>();
    for (const c of depositCollections) {
      if (!c.collectedByProxyOwnerId) continue;
      const key = c.collectedByProxyOwnerId.toString();
      byVekil.set(key, (byVekil.get(key) ?? 0) + c.amount);
    }
    for (const [ownerId, amount] of byVekil) {
      await postLedgerEntry(ctx, actor, {
        propertyId: contract.propertyId,
        contractId: contract._id,
        personType: "proxy",
        personId: ownerId as Id<"owners">,
        ownerId: ownerId as Id<"owners">,
        kind: "depositReturn",
        amount,
        description: "Depozito iadesi (vekil)",
        date,
        referenceId,
      });
      entriesPosted += 1;
    }

    return { entriesPosted };
  },
});

/** Generate missing monthly accruals for a contract (idempotent). */
const generateMissingAccruals = async (
  ctx: MutationCtx,
  actor: Doc<"users">,
  contract: Contract,
) => {
  const existing = await ctx.db
    .query("accruals")
    .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
    .collect();
  const have = new Set(existing.map((a) => a.period));
  for (const month of contractMonths(contract)) {
    if (!have.has(month.period)) {
      await createAccrualWithLedger(ctx, actor, contract, month);
    }
  }
};

/** Generate missing accruals from the UI (per contract). */
export const generateAccruals = mutation({
  args: { id: v.id("contracts") },
  handler: async (ctx, { id }) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(id);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);
    await generateMissingAccruals(ctx, actor, contract);
    return true;
  },
});

/* ------------------- Signed contract upload (storage) ------------------- */

/** Generate an upload URL for the signed contract file (client-side POST). */
export const generateUploadUrl = action({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attach the uploaded signed contract to a contract. */
export const attachSignedContract = mutation({
  args: {
    contractId: v.id("contracts"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { contractId, storageId }) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);
    await ctx.db.patch(contractId, {
      signedContractStorageId: storageId,
    });
    return true;
  },
});

/** Resolve a signed contract's download URL. */
export const getSignedContractUrl = query({
  args: { storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, { storageId }) => {
    if (!storageId) return null;
    return await ctx.storage.getUrl(storageId);
  },
});

/** Remove a previously attached signed contract. */
export const detachSignedContract = mutation({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);
    if (contract.signedContractStorageId) {
      await ctx.storage.delete(contract.signedContractStorageId);
    }
    await ctx.db.patch(contractId, {
      signedContractStorageId: undefined,
    });
    return true;
  },
});
