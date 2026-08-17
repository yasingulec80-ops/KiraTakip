import { ConvexError, v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  ROLES,
  contractStatusValidator,
  fixtureValidator,
  guarantorValidator,
  rentVatValidator,
} from "./schema";
import {
  deleteLedgerForReference,
  getActor,
  getAuthorizedPropertyIds,
  postLedgerEntry,
  requireActor,
  requirePropertyAccess,
} from "./ledger_helpers";
import { depositAccrualDecision } from "../lib/ledger-posts";
import { nextIncreaseDateOf, rentAccrualsToUpdate } from "../lib/rent-increase";
import {
  increaseNotificationRecipients,
  increaseNotifyEmails,
} from "../lib/increase-notify";
import {
  contractMonths,
  createAccrualWithLedger,
  periodKey,
  postAccrualLedger,
} from "./ledger_ops";

const contractArgs = {
  propertyId: v.id("properties"),
  ownerId: v.id("owners"),
  tenantId: v.id("tenants"),
  startDate: v.number(),
  durationMonths: v.number(),
  rentAmount: v.number(),
  rentVat: v.optional(rentVatValidator),
  vatRate: v.optional(v.number()),
  rentIncreaseRate: v.optional(v.number()),
  useTuikInflation: v.optional(v.boolean()),
  depositAmount: v.number(),
  depositMonths: v.optional(v.number()),
  guarantor: v.optional(guarantorValidator),
  evictionCommitment: v.optional(v.boolean()),
  evictionCommitmentDate: v.optional(v.number()),
  evictionDate: v.optional(v.number()),
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
    if (
      args.evictionCommitment &&
      args.evictionCommitmentDate &&
      args.evictionCommitmentDate === args.startDate
    ) {
      throw new ConvexError(
        "Taahhüt tarihi, kontrat (başlangıç) tarihi ile aynı olamaz.",
      );
    }

    const nextIncreaseDate = nextIncreaseDateOf(
      args.startDate,
      args.durationMonths,
      null,
    );
    const contractId = await ctx.db.insert("contracts", {
      ...args,
      fixtures: args.fixtures ?? [],
      status: args.status ?? "active",
      nextIncreaseDate: nextIncreaseDate ?? undefined,
      createdBy: actor._id,
    });
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError("Kontrat oluşturulamadı.");

    for (const month of contractMonths(contract)) {
      await createAccrualWithLedger(ctx, actor, contract, month);
    }

    // Depozito tahakkuku — kontrat kaydedildiğinde otomatik oluşturulur ve
    // cari hesaplara işlenir (kiracı borçlanır, malik alacaklanır).
    if ((contract.depositAmount ?? 0) > 0) {
      await createAccrualWithLedger(
        ctx,
        actor,
        contract,
        { period: periodKey(contract.startDate), dueDate: contract.startDate },
        contract.depositAmount,
        "deposit",
      );
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
    if (
      data.evictionCommitment &&
      data.evictionCommitmentDate &&
      data.evictionCommitmentDate === data.startDate
    ) {
      throw new ConvexError(
        "Taahhüt tarihi, kontrat (başlangıç) tarihi ile aynı olamaz.",
      );
    }
    // Başlangıç tarihi değiştiyse artış yıldönümleri eski tarihe göre bayatlar;
    // yeni başlangıçtan ilk yıldönümü yeniden hesaplanır. Değişmediyse kayıtlı
    // sonraki artış tarihi korunur (artış uygulanarak ilerletilmiş olabilir).
    const nextIncreaseDate =
      data.startDate !== contract.startDate ||
      data.durationMonths !== contract.durationMonths
        ? nextIncreaseDateOf(data.startDate, data.durationMonths, null)
        : contract.nextIncreaseDate;
    await ctx.db.patch(id, {
      propertyId: data.propertyId,
      ownerId: data.ownerId,
      tenantId: data.tenantId,
      startDate: data.startDate,
      durationMonths: data.durationMonths,
      rentAmount: data.rentAmount,
      rentVat: data.rentVat,
      vatRate: data.vatRate,
      rentIncreaseRate: data.rentIncreaseRate,
      useTuikInflation: data.useTuikInflation,
      nextIncreaseDate: nextIncreaseDate ?? undefined,
      depositAmount: data.depositAmount,
      depositMonths: data.depositMonths,
      guarantor: data.guarantor,
      evictionCommitment: data.evictionCommitment,
      evictionCommitmentDate: data.evictionCommitmentDate,
      evictionDate: data.evictionDate,
      fixtures: data.fixtures ?? [],
      notes: data.notes,
      status: data.status ?? "active",
    });

    const updated = await ctx.db.get(id);
    if (updated) {
      await generateMissingAccruals(ctx, actor, updated);
      await syncDepositAccrual(ctx, actor, updated);
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
 * Apply a rent increase from the tracking tile.
 *
 * Kontratın kira tutarını günceller, artış oranını ve uygulama tarihini
 * kaydeder, sonraki artış tarihini 12 ay ileri alır. Gelecek kira
 * tahakkukları (etkili tarihten itibaren) yeni tutara güncellenir; vadesi
 * gelmiş tahakkukların cari hesap kayıtları yeni tutarla yeniden işlenir
 * (kiracı borcu / malik alacağı doğru kalır).
 */
export const applyRentIncrease = mutation({
  args: {
    contractId: v.id("contracts"),
    newRentAmount: v.number(),
    rate: v.number(),
    effectiveDate: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new ConvexError("Kontrat bulunamadı.");
    await requirePropertyAccess(ctx, actor, contract.propertyId);
    if (args.rate < 0) {
      throw new ConvexError("Artış oranı negatif olamaz.");
    }
    if (args.newRentAmount <= 0) {
      throw new ConvexError("Yeni kira tutarı geçerli olmalıdır.");
    }
    if (args.effectiveDate < contract.startDate) {
      throw new ConvexError(
        "Artış tarihi kontrat başlangıcından önce olamaz.",
      );
    }

    const nextIncreaseDate = nextIncreaseDateOf(
      contract.startDate,
      contract.durationMonths,
      contract.nextIncreaseDate,
    );
    await ctx.db.patch(contract._id, {
      rentAmount: args.newRentAmount,
      rentIncreaseRate: args.rate,
      lastIncreaseDate: args.effectiveDate,
      nextIncreaseDate: nextIncreaseDate ?? undefined,
    });

    // Gelecek kira tahakkuklarını yeni tutara güncelle. Depozito tahakkuku
    // (type = deposit) kira döngüsüne dahil değildir — dokunulmaz.
    const accruals = await ctx.db
      .query("accruals")
      .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
      .collect();
    let updatedAccruals = 0;
    for (const accrual of rentAccrualsToUpdate(
      accruals,
      args.effectiveDate,
      args.newRentAmount,
    )) {
      await ctx.db.patch(accrual._id, { amount: args.newRentAmount });
      updatedAccruals++;
      // Vadesi gelmiş tahakkukların cari kayıtlarını yeni tutarla yeniden işle
      // (gelecek aylar vadeye girince cron yeni tutarı işler).
      if (accrual.dueDate <= Date.now()) {
        await deleteLedgerForReference(ctx, accrual._id.toString());
        await postAccrualLedger(ctx, actor, contract, {
          _id: accrual._id,
          period: accrual.period,
          dueDate: accrual.dueDate,
          amount: args.newRentAmount,
        });
      }
    }

    // Malik ve kiracıya e-posta bildirimi — mutation commit olduktan sonra
    // scheduler action'ı tetikler. Alıcılar hatırlatma ayarlarındaki kiracı/
    // malik tercihlerine uyar; e-postası olmayan taraf atlanır. E-posta
    // gateway'i (VLY_INTEGRATION_KEY) yapılandırılmamışsa action sessizce no-op.
    const [owner, tenant, property] = await Promise.all([
      ctx.db.get(contract.ownerId),
      ctx.db.get(contract.tenantId),
      ctx.db.get(contract.propertyId),
    ]);
    const notifySettings = await ctx.runQuery(api.settings.getReminderSettings);
    const recipients = increaseNotificationRecipients(owner, tenant, {
      notifyTenant: notifySettings.notifyTenant,
      notifyOwner: notifySettings.notifyOwner,
    });
    const notifiedRoles = recipients.map((r) => r.role);
    if (recipients.length > 0) {
      // Yalnızca tercih filtresinden geçen alıcıların e-postaları action'a
      // aktarılır — action kendi alıcı listesini bu e-postalardan kurar.
      const emails = increaseNotifyEmails(recipients);
      await ctx.scheduler.runAfter(
        0,
        internal.reminders.sendRentIncreaseNotification,
        {
          propertyName: property?.name ?? "Gayrimenkul",
          tenantName: tenant?.name ?? "Kiracı",
          tenantEmail: emails.tenantEmail,
          ownerName: owner?.name ?? "Malik",
          ownerEmail: emails.ownerEmail,
          oldRent: contract.rentAmount,
          newRent: args.newRentAmount,
          rate: args.rate,
          effectiveDate: args.effectiveDate,
          nextIncreaseDate: nextIncreaseDate ?? undefined,
        },
      );
    }

    return {
      rentAmount: args.newRentAmount,
      updatedAccruals,
      nextIncreaseDate: nextIncreaseDate ?? undefined,
      notifyScheduled: recipients.length > 0,
      notifiedRoles,
    };
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
    returnedByProxyOwnerId: v.optional(v.id("owners")), // vekil üzerinden iade
  },
  handler: async (ctx, args) => {
    const { contractId, date, note } = args;
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

    // Vekil üzerinden iade: depozitoyu tahsil eden vekil iadeyi yaparsa,
    // vekilin cari hesabındaki borç devir (transfer) olarak kapatılır ve
    // tutar vekilin teslim edilebilir bakiyesinden düşülür. Vekil seçilmezse
    // vekilin borcu korunur; tahsil ettiği tutarı ayrıca malike devredebilir.
    const proxyOwnerId = args.returnedByProxyOwnerId;
    if (proxyOwnerId) {
      const vekilOwner = await ctx.db.get(proxyOwnerId);
      if (vekilOwner?.proxy) {
        const vekilPortion = depositCollections
          .filter(
            (c) => c.collectedByProxyOwnerId?.toString() === proxyOwnerId.toString(),
          )
          .reduce((sum, c) => sum + c.amount, 0);

        // Vekilin tahsil edip henüz devretmediği toplam tutar (devir akışıyla aynı hesap).
        const vekilEntries = await ctx.db
          .query("ledgerEntries")
          .withIndex("by_person", (q) =>
            q.eq("personType", "proxy").eq("personId", proxyOwnerId),
          )
          .collect();
        const outstanding = vekilEntries.reduce((sum, e) => {
          if (
            e.kind === "collection" &&
            e.description.startsWith("Vekil tahsilatı")
          ) {
            return sum + Math.abs(e.amount);
          }
          if (e.kind === "transfer") return sum - e.amount;
          return sum;
        }, 0);

        const clearAmount = Math.min(vekilPortion, outstanding, totalCollected);
        if (clearAmount > 0) {
          await postLedgerEntry(ctx, actor, {
            propertyId: contract.propertyId,
            contractId: contract._id,
            personType: "proxy",
            personId: proxyOwnerId,
            ownerId: proxyOwnerId,
            kind: "transfer",
            amount: clearAmount,
            description: "Vekil devri — depozito iadesi",
            date,
            referenceId,
          });
          entriesPosted += 1;
        }
      }
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
  // Depozito tahakkuku aylık kira döngüsünün dışındadır — ilk ayın dönemiyle
  // çakışmasına rağmen kira tahakkuku olarak kabul edilmez.
  const rentPeriods = new Set(
    existing
      .filter((a) => (a.type ?? "rent") !== "deposit")
      .map((a) => a.period),
  );
  for (const month of contractMonths(contract)) {
    if (!rentPeriods.has(month.period)) {
      await createAccrualWithLedger(ctx, actor, contract, month);
    }
  }
};

/**
 * Keep the automatic deposit accrual in sync with the contract's deposit.
 * Creates it when a deposit appears, updates its amount when it changes
 * (re-posting the cari hesap entries), and removes it when the deposit is
 * cleared to zero.
 */
const syncDepositAccrual = async (
  ctx: MutationCtx,
  actor: Doc<"users">,
  contract: Contract,
) => {
  const accruals = await ctx.db
    .query("accruals")
    .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
    .collect();
  const depositAccrual = accruals.find(
    (a) => (a.type ?? "rent") === "deposit",
  );

  // Karar paylaşılan saf kuraldan gelir (create / update / delete / none).
  const decision = depositAccrualDecision(
    contract.depositAmount ?? 0,
    depositAccrual
      ? { amount: depositAccrual.amount, dueDate: depositAccrual.dueDate }
      : null,
    contract.startDate,
    Date.now(),
  );

  if (decision.action === "create") {
    await createAccrualWithLedger(
      ctx,
      actor,
      contract,
      { period: decision.period, dueDate: decision.dueDate },
      decision.amount,
      "deposit",
    );
    return;
  }

  if (decision.action === "delete") {
    // Depozito kaldırıldı: tahakkuk ve cari kayıtları temizle.
    if (depositAccrual) {
      await deleteLedgerForReference(ctx, depositAccrual._id.toString());
      await ctx.db.delete(depositAccrual._id);
    }
    return;
  }

  if (decision.action === "update" && depositAccrual) {
    await ctx.db.patch(depositAccrual._id, {
      amount: decision.amount,
      dueDate: decision.dueDate,
      period: decision.period,
    });
    await deleteLedgerForReference(ctx, depositAccrual._id.toString());
    if (decision.shouldPost) {
      await postAccrualLedger(
        ctx,
        actor,
        contract,
        {
          _id: depositAccrual._id,
          period: decision.period,
          dueDate: decision.dueDate,
          amount: decision.amount,
        },
        "deposit",
      );
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
