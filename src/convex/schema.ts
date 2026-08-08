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
