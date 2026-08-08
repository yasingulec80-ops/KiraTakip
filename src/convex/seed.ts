import { ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import {
  contractMonths,
  createAccrualWithLedger,
  createCollectionWithLedger,
  createExpenseWithLedger,
} from "./ledger_ops";
import { refreshAccrualStatus } from "./accruals";

const at = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12).getTime();

/**
 * DEV SEED — demo verisi oluşturur (yalnızca boş veritabanında çalışır).
 *
 * Gayrimenkul + Malik (vekillî) + Kiracı (kefilli) + Kontrat oluşturur,
 * kontrat üzerinden otomatik aylık tahakkukları üretir, bir tahsilat kaydı
 * girer ve üç masraf (aidat / boya / tadilat) kaydeder. Tüm işlemler aynı
 * cari hesap motorundan (ledger_ops) geçtiği için cari hesaplara işlenir.
 *
 * Çağrı: bunx convex run seed:seedDemoData
 * Güvenlik: veritabanında malik ya da gayrimenkul varsa hata fırlatır, böylece
 * gerçek veri üzerine asla yazmaz. Üretimde bu dosyayı kaldırın.
 */
export const seedDemoData = mutation({
  handler: async (ctx) => {
    const ownersCount = (await ctx.db.query("owners").collect()).length;
    const propertiesCount = (await ctx.db.query("properties").collect()).length;
    if (ownersCount > 0 || propertiesCount > 0) {
      throw new ConvexError(
        "Veritabanı boş değil — demo verisi oluşturulmadı. Seed yalnızca boş veritabanında çalışır.",
      );
    }

    const actor =
      (await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("role"), "admin"))
        .first()) ??
      (await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), "Admin"))
        .first()) ??
      (await ctx.db.query("users").first());
    if (!actor) {
      throw new ConvexError(
        "Önce Admin / 8842 ile bir kez giriş yapın, sonra seed'i tekrar çalıştırın.",
      );
    }

    /* ------------------------- Malik (vekillî) ------------------------- */
    const ownerId = await ctx.db.insert("owners", {
      name: "Ahmet Yılmaz",
      tcNo: "12345678901",
      phone: "0532 111 22 33",
      address: "Moda Cad. No:5 D:3, Kadıköy / İstanbul",
      email: "ahmet.yilmaz@example.com",
      bankName: "Ziraat Bankası",
      iban: "TR33 0006 1005 1978 6457 8413 26",
      proxy: {
        name: "Mehmet Kaya",
        tcNo: "98765432109",
        phone: "0533 444 55 66",
      },
      createdBy: actor._id,
    });

    /* ------------------------- Kiracı (kefilli) ------------------------ */
    const tenantId = await ctx.db.insert("tenants", {
      name: "Elif Demir",
      tcNo: "23456789012",
      phone: "0535 777 88 99",
      address: "Bağdat Cad. No:12 D:4, Kadıköy / İstanbul",
      email: "elif.demir@example.com",
      guarantor: {
        name: "Ali Arslan",
        tcNo: "34567890123",
        phone: "0536 555 66 77",
        address: "Acıbadem Cad. No:8, Üsküdar / İstanbul",
        email: "ali.arslan@example.com",
      },
      createdBy: actor._id,
    });

    /* --------------------------- Gayrimenkul -------------------------- */
    const propertyId = await ctx.db.insert("properties", {
      ownerId,
      name: "Bağdat Cad. No:12 D:4",
      address: "Caddebostan, Bağdat Cad. No:12 D:4, Kadıköy / İstanbul",
      m2: 120,
      roomCount: "3+1",
      facade: "Güney",
      electricityMeter: "EL-482913",
      waterMeter: "SU-773120",
      gasMeter: "DG-330458",
      fixtures: [
        { name: "Buzdolabı", quantity: 1 },
        { name: "Çamaşır Makinesi", quantity: 1 },
        { name: "Klima", quantity: 2 },
        { name: "Yatak Odası Takımı", quantity: 1 },
      ],
      notes: "Demo gayrimenkul — deneme verisi.",
      createdBy: actor._id,
    });

    /* ----------------------------- Kontrat ----------------------------- */
    const startDate = at(2026, 7, 1);
    const rentAmount = 18500;
    const contractId = await ctx.db.insert("contracts", {
      propertyId,
      ownerId,
      tenantId,
      startDate,
      durationMonths: 12,
      rentAmount,
      depositAmount: 55500,
      depositStatus: "paid",
      fixtures: [
        { name: "Buzdolabı", quantity: 1 },
        { name: "Çamaşır Makinesi", quantity: 1 },
        { name: "Klima", quantity: 2 },
      ],
      notes: "Demo kontrat — 12 ay, aylık 18.500 ₺.",
      status: "active",
      createdBy: actor._id,
    });
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError("Kontrat oluşturulamadı.");

    // Otomatik aylık tahakkuklar + cari hesap kayıtları (kiracı borç, malik alacak).
    for (const month of contractMonths(contract)) {
      await createAccrualWithLedger(ctx, actor, contract, month);
    }

    /* ---------------------- Tahsilat (Ağustos kirası) ------------------ */
    const accruals = await ctx.db
      .query("accruals")
      .withIndex("by_contract", (q) => q.eq("contractId", contractId))
      .collect();
    const julyAccrual = accruals.find((a) => a.period === "2026-07");
    const accrualId = julyAccrual?._id ?? accruals[0]?._id;

    if (accrualId) {
      // Kira tahsilatı — tahsilatı vekil (Mehmet Kaya) yaptı → vekilin cari hesabına borç işlenir.
      await createCollectionWithLedger(ctx, actor, contract, {
        accrualId,
        amount: rentAmount,
        date: at(2026, 8, 3),
        paidByType: "tenant",
        tenantId,
        collectedByProxyOwnerId: ownerId,
        notes: "Ağustos kira ödemesi (vekil tahsil etti)",
      });
      await refreshAccrualStatus(ctx, accrualId);
    }

    // Depozito tahsilatı — kiracı öder, vekil tahsil eder, cari hesaplara işlenir.
    // İade, Depozitolar modülünden vekil üzerinden yapılabilir (devir akışına işlenir).
    await createCollectionWithLedger(ctx, actor, contract, {
      amount: contract.depositAmount,
      date: at(2026, 7, 1),
      paidByType: "tenant",
      tenantId,
      collectionType: "deposit",
      collectedByProxyOwnerId: ownerId,
      notes: "Depozito tahsilatı (vekil tahsil etti)",
    });

    /* ----------------------------- Masraflar --------------------------- */
    // Aidat — malik ödedi → malik borçlanır.
    await createExpenseWithLedger(ctx, actor, {
      propertyId,
      contractId,
      category: "aidat",
      amount: 2500,
      date: at(2026, 8, 5),
      paidByType: "owner",
      payerOwnerId: ownerId,
      description: "Ağustos site aidatı",
    });

    // Boya — kiracı ödedi → kiracı alacaklanır (kira hesabına mahsup).
    await createExpenseWithLedger(ctx, actor, {
      propertyId,
      contractId,
      category: "boya",
      amount: 3200,
      date: at(2026, 8, 10),
      paidByType: "tenant",
      payerTenantId: tenantId,
      description: "Daire iç boya (kiracı ödedi)",
    });

    // Tadilat — vekil ödedi → vekil alacaklanır, malik borçlanır.
    await createExpenseWithLedger(ctx, actor, {
      propertyId,
      contractId,
      category: "tadilat",
      amount: 5400,
      date: at(2026, 8, 12),
      paidByType: "proxy",
      payerOwnerId: ownerId,
      description: "Banyo musluk ve tesisat tadilatı (vekil)",
    });

    const ledgerCount = (await ctx.db.query("ledgerEntries").collect()).length;

    return {
      ownerId,
      tenantId,
      propertyId,
      contractId,
      accruals: accruals.length,
      collections: 2,
      expenses: 3,
      ledgerEntries: ledgerCount,
    };
  },
});
