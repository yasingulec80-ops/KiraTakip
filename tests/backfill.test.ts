import { describe, expect, test } from "bun:test";
import {
  planBackfill,
  staleFieldsFor,
  type BackfillPerson,
} from "../src/lib/backfill-rules";

/* ----------------------------- fixtures ------------------------------- */

const companyOwner = (overrides: Partial<BackfillPerson> = {}): BackfillPerson => ({
  id: "owner-co-1",
  isCompany: true,
  tcNo: "12345678901", // bayat kişisel TC — temizlenmeli
  taxOffice: "İstanbul VD",
  taxNumber: "9990011223",
  signatoryName: "Ayşe Yönetici",
  signatoryTcNo: "10987654321",
  ...overrides,
});

const personOwner = (overrides: Partial<BackfillPerson> = {}): BackfillPerson => ({
  id: "owner-p-1",
  isCompany: false,
  tcNo: "11111111111",
  ...overrides,
});

const companyTenant = (overrides: Partial<BackfillPerson> = {}): BackfillPerson => ({
  id: "tenant-co-1",
  isCompany: true,
  tcNo: "98765432109", // bayat kişisel TC — temizlenmeli
  taxOffice: "Ankara VD",
  taxNumber: "8880001122",
  ...overrides,
});

const personTenant = (overrides: Partial<BackfillPerson> = {}): BackfillPerson => ({
  id: "tenant-p-1",
  isCompany: false,
  tcNo: "22222222222",
  ...overrides,
});

const TAX_PATCH = {
  taxOffice: null,
  taxNumber: null,
  signatoryName: null,
  signatoryTcNo: null,
};

/* ---------------------- staleFieldsFor — kurallar --------------------- */

describe("staleFieldsFor — yama seçim kuralı", () => {
  test("şirket + eski tcNo → yalnızca tcNo silinir (şirket alanları korunur)", () => {
    expect(staleFieldsFor(companyOwner())).toEqual({ tcNo: null });
  });

  test("tcNo'su olmayan şirket → yama yok (dokunulmaz)", () => {
    expect(staleFieldsFor(companyOwner({ tcNo: undefined }))).toBeNull();
    expect(staleFieldsFor(companyOwner({ tcNo: null }))).toBeNull();
  });

  test("kişi + şirket alanları → yalnızca şirket alanları silinir (TC korunur)", () => {
    expect(
      staleFieldsFor(personOwner({ taxOffice: "İstanbul VD", taxNumber: "9990011223" })),
    ).toEqual(TAX_PATCH);
  });

  test("temiz kişi → yama yok", () => {
    expect(staleFieldsFor(personOwner())).toBeNull();
  });

  test("boş string tcNo (falsy) şirkette temizlik tetiklemez", () => {
    expect(staleFieldsFor(companyOwner({ tcNo: "" }))).toBeNull();
  });

  test("kişi kaydında yalnızca bir şirket alanı varsa yine tam tax yaması üretilir", () => {
    expect(staleFieldsFor(personOwner({ signatoryName: "X" }))).toEqual(TAX_PATCH);
  });
});

/* ------------------- planBackfill — sayım ve yazma -------------------- */

describe("planBackfill — karışık senaryo", () => {
  const owners = [
    companyOwner(), // tc → silinecek
    companyOwner({ id: "owner-co-2" }), // tc → silinecek
    personOwner({ id: "owner-p-2", taxNumber: "123" }), // tax → silinecek
    companyOwner({ id: "owner-co-clean", tcNo: undefined }), // temiz şirket
    personOwner({ id: "owner-p-clean" }), // temiz kişi
  ];
  const tenants = [
    companyTenant(), // tc → silinecek
    personTenant({ id: "tenant-p-2", taxOffice: "İzmir VD" }), // tax → silinecek
    personTenant({ id: "tenant-p-clean" }), // temiz kişi
  ];

  test("sayımlar: tc yalnızca şirketlerden, tax yalnızca kişilerden", () => {
    const { summary } = planBackfill(owners, tenants, false);
    expect(summary).toEqual({
      ownersClearedTc: 2,
      ownersClearedTax: 1,
      tenantsClearedTc: 1,
      tenantsClearedTax: 1,
      totalCleared: 5,
    });
  });

  test("dry-run: sayım birebir aynı ama hiçbir yama üretilmez (yazma yok)", () => {
    const real = planBackfill(owners, tenants, false);
    const dry = planBackfill(owners, tenants, true);

    expect(dry.summary).toEqual(real.summary);
    expect(dry.writes).toEqual([]);
    expect(real.writes.length).toBe(real.summary.totalCleared);
  });

  test("gerçek mod: yazılan her yama yalnızca bayat alanı hedefler", () => {
    const { writes } = planBackfill(owners, tenants, false);

    // 2 malik tc + 1 malik tax + 1 kiracı tc + 1 kiracı tax
    expect(writes).toHaveLength(5);

    const tcWrites = writes.filter((w) => "tcNo" in w.patch);
    const taxWrites = writes.filter((w) => "taxOffice" in w.patch);

    // tc yamaları: yalnızca şirket kayıtlarına, yalnızca { tcNo: null }
    expect(tcWrites.map((w) => w.id).sort()).toEqual([
      "owner-co-1",
      "owner-co-2",
      "tenant-co-1",
    ]);
    expect(tcWrites.map((w) => w.table).sort()).toEqual([
      "owners",
      "owners",
      "tenants",
    ]);
    for (const w of tcWrites) {
      expect(w.patch).toEqual({ tcNo: null });
    }

    // tax yamaları: yalnızca kişi kayıtlarına, yalnızca şirket alanları
    expect(taxWrites.map((w) => w.id).sort()).toEqual([
      "owner-p-2",
      "tenant-p-2",
    ]);
    for (const w of taxWrites) {
      expect(w.patch).toEqual(TAX_PATCH);
    }

    // temiz kayıtlar hiçbir listede yok
    const writtenIds = writes.map((w) => w.id);
    expect(writtenIds).not.toContain("owner-co-clean");
    expect(writtenIds).not.toContain("owner-p-clean");
    expect(writtenIds).not.toContain("tenant-p-clean");
  });

  test("kayıtlar tc ve tax'i aynı anda taşıyamaz — şirket kaydında tax yaması üretilmez", () => {
    // Şirket kaydındaki eski TC silinir; şirket alanları zaten geçerli olduğu için tax yaması çıkmaz.
    const only = [companyOwner({ id: "o", taxOffice: "İstanbul VD" })];
    const { summary, writes } = planBackfill(only, [], false);
    expect(summary).toEqual({
      ownersClearedTc: 1,
      ownersClearedTax: 0,
      tenantsClearedTc: 0,
      tenantsClearedTax: 0,
      totalCleared: 1,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].patch).toEqual({ tcNo: null });
  });
});
