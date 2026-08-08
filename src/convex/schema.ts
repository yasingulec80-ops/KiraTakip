import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.MANAGER),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// Vekil (proxy) — the owner can appoint a proxy who acts on their behalf
export const proxyValidator = v.union(
  v.null(),
  v.object({
    name: v.string(),
    tcNo: v.string(),
    phone: v.string(),
  }),
);
export type Proxy = Infer<typeof proxyValidator>;

// Kefil (guarantor) — the tenant can provide a guarantor
export const guarantorValidator = v.union(
  v.null(),
  v.object({
    name: v.string(),
    tcNo: v.string(),
    phone: v.string(),
    address: v.string(),
    email: v.string(),
  }),
);
export type Guarantor = Infer<typeof guarantorValidator>;

// Demirbaş (fixture) — an inventory item inside the property
export const fixtureValidator = v.object({
  name: v.string(),
  quantity: v.number(),
});
export type Fixture = Infer<typeof fixtureValidator>;

// Kontrat durumu — sözleşme aktif veya sona ermiş
export const contractStatusValidator = v.union(
  v.literal("active"),
  v.literal("ended"),
);
export type ContractStatus = Infer<typeof contractStatusValidator>;

// Depozito durumu — alındı / elde tutuluyor / iade edildi
export const depositStatusValidator = v.union(
  v.literal("paid"),
  v.literal("held"),
  v.literal("returned"),
);
export type DepositStatus = Infer<typeof depositStatusValidator>;

// Tahakkuk durumu — bekliyor / kısmen ödendi / ödendi
export const accrualStatusValidator = v.union(
  v.literal("pending"),
  v.literal("partial"),
  v.literal("paid"),
);
export type AccrualStatus = Infer<typeof accrualStatusValidator>;

// Masraf kalemleri — Aidat, Yatırım, Sigorta, Tadilat-Bakım/Onarım, Boya, Diğer
export const expenseCategoryValidator = v.union(
  v.literal("aidat"),
  v.literal("yatirim"),
  v.literal("sigorta"),
  v.literal("tadilat"),
  v.literal("boya"),
  v.literal("diger"),
);
export type ExpenseCategory = Infer<typeof expenseCategoryValidator>;

// Cari hesap sahibi türü — malik, kiracı veya vekil
export const ledgerPersonTypeValidator = v.union(
  v.literal("owner"),
  v.literal("tenant"),
  v.literal("proxy"),
);
export type LedgerPersonType = Infer<typeof ledgerPersonTypeValidator>;

// Cari hesap kaydı türü
export const ledgerKindValidator = v.union(
  v.literal("accrual"),
  v.literal("collection"),
  v.literal("expense"),
  v.literal("adjustment"),
  v.literal("depositReturn"),
  v.literal("transfer"),
);
export type LedgerKind = Infer<typeof ledgerKindValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user / login username. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user ("admin" | "manager")
      authorizedPropertyIds: v.optional(v.array(v.id("properties"))), // properties this user may access (all for admin)
      isActive: v.optional(v.boolean()), // whether the account is active
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Gayrimenkuller — properties managed in the portfolio
    properties: defineTable({
      ownerId: v.optional(v.id("owners")), // linked malik (owner)
      name: v.string(), // Gayrimenkul Adı
      address: v.string(), // Adres
      m2: v.optional(v.number()), // M2
      roomCount: v.optional(v.string()), // Oda Sayısı (e.g. "3+1")
      facade: v.optional(v.string()), // Cephe Bilgisi
      electricityMeter: v.optional(v.string()), // Elektrik Sayaç/Bağlantı No
      waterMeter: v.optional(v.string()), // Su Sayaç/Bağlantı No
      gasMeter: v.optional(v.string()), // Doğalgaz Sayaç/Bağlantı No
      fixtures: v.optional(v.array(fixtureValidator)), // Demirbaşlar
      notes: v.optional(v.string()),
      createdBy: v.optional(v.id("users")),
    }).index("by_owner", ["ownerId"]),

    // Malikler — property owners (with optional vekil/proxy)
    owners: defineTable({
      name: v.string(), // Adı Soyadı
      tcNo: v.string(), // TC Kimlik Numarası
      phone: v.string(), // Telefon Numarası
      address: v.string(), // Adresi
      email: v.string(), // Mail Adresi
      bankName: v.string(), // Banka Adı
      iban: v.string(), // IBAN Numarası
      proxy: proxyValidator, // Vekil (nullable)
      createdBy: v.optional(v.id("users")),
    }),

    // Kiracılar — tenants (with optional kefil/guarantor)
    tenants: defineTable({
      name: v.string(), // Adı Soyadı
      tcNo: v.string(), // TC Kimlik Numarası
      phone: v.string(), // Telefon Numarası
      address: v.string(), // Adresi
      email: v.string(), // Mail Adresi
      guarantor: guarantorValidator, // Kefil (nullable)
      createdBy: v.optional(v.id("users")),
    }),

    // Kontratlar — rental contracts between owner, tenant and property
    contracts: defineTable({
      propertyId: v.id("properties"), // Gayrimenkul
      ownerId: v.id("owners"), // Malik
      tenantId: v.id("tenants"), // Kiracı
      startDate: v.number(), // Başlangıç tarihi (ms)
      durationMonths: v.number(), // Kira süresi (ay)
      rentAmount: v.number(), // Aylık kira
      depositAmount: v.number(), // Depozito
      depositStatus: v.optional(depositStatusValidator), // Depozito durumu
      depositReturnedAt: v.optional(v.number()), // İade tarihi (ms)
      depositNote: v.optional(v.string()), // İade notu
      fixtures: v.optional(v.array(fixtureValidator)), // Kontrat bazlı demirbaşlar
      notes: v.optional(v.string()),
      signedContractStorageId: v.optional(v.id("_storage")), // İmzalı kontrat
      status: v.optional(contractStatusValidator), // aktif / sona erdi
      createdBy: v.optional(v.id("users")),
    })
      .index("by_property", ["propertyId"])
      .index("by_owner", ["ownerId"])
      .index("by_tenant", ["tenantId"]),

    // Tahakkuklar — monthly rent accruals
    accruals: defineTable({
      contractId: v.id("contracts"),
      propertyId: v.id("properties"),
      period: v.string(), // "2026-08" ay anahtarı
      dueDate: v.number(),
      amount: v.number(),
      status: v.optional(accrualStatusValidator),
      createdBy: v.optional(v.id("users")),
    })
      .index("by_contract", ["contractId"])
      .index("by_property", ["propertyId"]),

    // Tahsilatlar — rent collections
    collections: defineTable({
      contractId: v.id("contracts"),
      propertyId: v.id("properties"),
      accrualId: v.optional(v.id("accruals")),
      amount: v.number(),
      date: v.number(),
      paidByType: v.optional(
        v.union(v.literal("tenant"), v.literal("proxy")),
      ),
      collectionType: v.optional(
        v.union(v.literal("rent"), v.literal("deposit")),
      ), // kira / depozito tahsilatı
      tenantId: v.optional(v.id("tenants")), // paidByType = tenant
      proxyOwnerId: v.optional(v.id("owners")), // paidByType = proxy
      collectedByProxyOwnerId: v.optional(v.id("owners")), // tahsilatı yapan vekil (borç işlenir)
      notes: v.optional(v.string()),
      createdBy: v.optional(v.id("users")),
    })
      .index("by_contract", ["contractId"])
      .index("by_property", ["propertyId"])
      .index("by_accrual", ["accrualId"]),

    // Masraflar — property expenses
    expenses: defineTable({
      propertyId: v.id("properties"),
      contractId: v.optional(v.id("contracts")),
      category: expenseCategoryValidator,
      amount: v.number(),
      date: v.number(),
      paidByType: v.optional(ledgerPersonTypeValidator),
      payerOwnerId: v.optional(v.id("owners")), // paidByType = owner / proxy
      payerTenantId: v.optional(v.id("tenants")), // paidByType = tenant
      description: v.string(),
      createdBy: v.optional(v.id("users")),
    }).index("by_property", ["propertyId"]),

    // Cari hesaplar — per-person ledger entries
    // Uygulama ayarları (ör. kira hatırlatma tercihleri)
    settings: defineTable({
      key: v.string(),
      daysBefore: v.optional(v.number()), // vadeden kaç gün önce hatırlatılacağı
      notifyTenant: v.optional(v.boolean()), // kiracıya e-posta
      notifyOwner: v.optional(v.boolean()), // malike e-posta
    }).index("by_key", ["key"]),

    // Kira hatırlatma e-postaları — gönderim kaydı (mükerrer gönderimi önler)
    reminderLogs: defineTable({
      accrualId: v.id("accruals"),
      recipientEmail: v.string(),
      sentAt: v.number(),
    }).index("by_accrual", ["accrualId"]),

    ledgerEntries: defineTable({
      propertyId: v.optional(v.id("properties")),
      contractId: v.optional(v.id("contracts")),
      personType: ledgerPersonTypeValidator,
      personId: v.union(v.id("owners"), v.id("tenants")),
      ownerId: v.optional(v.id("owners")), // vekil satırları için malik
      kind: ledgerKindValidator,
      amount: v.number(), // pozitif = alacak, negatif = borç
      description: v.string(),
      date: v.number(),
      referenceId: v.optional(v.string()),
      createdBy: v.optional(v.id("users")),
    })
      .index("by_person", ["personType", "personId"])
      .index("by_property", ["propertyId"]),

    // add other tables here

    // tableName: defineTable({
    //   ...
    //   // table fields
    // }).index("by_field", ["field"])
  },
  {
    schemaValidation: false,
  },
);

export default schema;
