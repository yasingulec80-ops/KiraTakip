import { describe, expect, test } from "bun:test";
import {
  planBackfill,
  staleFieldsFor,
  type BackfillPerson,
} from "../src/lib/backfill-rules";

const owner = (overrides: Partial<BackfillPerson> = {}): BackfillPerson => ({
  id: "owner-1",
  ...overrides,
});
const tenant = (overrides: Partial<BackfillPerson> = {}): BackfillPerson => ({
  id: "tenant-1",
  ...overrides,
});

describe("staleFieldsFor", () => {
  test("şirket kaydında eski kişisel tcNo varsa yalnızca tcNo temizlenir", () => {
    expect(
      staleFieldsFor(
        owner({
          isCompany: true,
          tcNo: "12345678901",
          taxOffice: "Kadıköy",
          taxNumber: "9990001112",
        }),
      ),
    ).toEqual({ tcNo: null });
  });

  test("kişi kaydında şirket alanları varsa yalnızca o alanlar temizlenir", () => {
    expect(
      staleFieldsFor(
        owner({
          isCompany: false,
          tcNo: "12345678901",
          taxOffice: "Kadıköy",
          taxNumber: "9990001112",
          signatoryName: "Ahmet",
          signatoryTcNo: "111",
        }),
      ),
    ).toEqual({
      taxOffice: null,
      taxNumber: null,
      signatoryName: null,
      signatoryTcNo: null,
    });
  });

  test("temiz alan varsa dokunmaz", () => {
    expect(staleFieldsFor(owner({ isCompany: true }))).toBeNull();
    expect(staleFieldsFor(owner({ isCompany: false, tcNo: "12345678901" }))).toBeNull();
    expect(staleFieldsFor(owner({}))).toBeNull();
  });
});

describe("planBackfill", () => {
  const owners = [
    owner({ id: "o1", isCompany: true, tcNo: "111" }), // → tc
    owner({ id: "o2", isCompany: false, taxOffice: "Kadıköy" }), // → tax
    owner({ id: "o3", isCompany: true, taxNumber: "999" }), // temiz — şirket, tax alanı sorun değil
    owner({ id: "o4" }), // temiz
  ];
  const tenants = [
    tenant({ id: "t1", isCompany: true, tcNo: "222" }), // → tc
    tenant({ id: "t2", isCompany: false, signatoryTcNo: "333" }), // → tax
    tenant({ id: "t3", isCompany: false, tcNo: "444" }), // temiz — kişide tcNo normal
  ];

  test("tcNo yalnızca şirket kayıtlarından, vergi alanları yalnızca kişilerden temizlenir", () => {
    const plan = planBackfill(owners, tenants, false);
    expect(plan.summary).toEqual({
      ownersClearedTc: 1,
      ownersClearedTax: 1,
      tenantsClearedTc: 1,
      tenantsClearedTax: 1,
      totalCleared: 4,
    });
    const patches = new Map(plan.writes.map((w) => [String(w.id), w.patch]));
    expect(patches.get("o1")).toEqual({ tcNo: null });
    expect(patches.get("o2")).toHaveProperty("taxOffice", null);
    expect(patches.has("o3")).toBe(false);
    expect(patches.get("t1")).toEqual({ tcNo: null });
    expect(patches.get("t2")).toHaveProperty("signatoryTcNo", null);
    expect(patches.has("t3")).toBe(false);
  });

  test("dry-run aynı sayıları üretir ama hiçbir yazma üretmez", () => {
    const dry = planBackfill(owners, tenants, true);
    const real = planBackfill(owners, tenants, false);
    expect(dry.summary).toEqual(real.summary);
    expect(dry.writes).toEqual([]);
    expect(real.writes).toHaveLength(4);
  });

  test("boş girdide sıfır sayar", () => {
    expect(planBackfill([], [], true).summary.totalCleared).toBe(0);
  });
});
