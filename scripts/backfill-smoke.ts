/**
 * BACKFILL SMOKE CHECK — yerel dry-run doğrulaması.
 *
 * Veritabanına DOKUNMAZ. Tohumlanmış (seeded) bir veri kümesi üzerinde
 * `planBackfill` kural mantığını çalıştırır ve beklenen sayımları doğrular:
 *
 *   - şirket kayıtlarından eski kişisel `tcNo` temizlenir
 *   - kişi kayıtlarından şirket alanları temizlenir
 *   - dry-run'da hiçbir yazma üretilmez (writes boştur)
 *
 * Çağrı:  bun run backfill:smoke
 * Çıkış:  tüm kontroller geçerse 0, bir hata varsa 0 dışı (rapor yazdırılır).
 *
 * Gerçek ortam akışı (docs/src/convex/backfill.ts):
 *   1. bun run backfill:smoke                    → bu script (yerel, yazma yok)
 *   2. bunx convex run backfill:stripStaleCompanyFields '{"dryRun":true}' → ön rapor
 *   3. sayılar beklenen gibiyse dryRun'suz gerçek temizlik
 */
import { planBackfill, type BackfillPerson } from "../src/lib/backfill-rules";

const owner = (id: string, overrides: Partial<BackfillPerson>): BackfillPerson => ({
  id,
  ...overrides,
});
const tenant = (id: string, overrides: Partial<BackfillPerson>): BackfillPerson => ({
  id,
  ...overrides,
});

const seededOwners: BackfillPerson[] = [
  owner("o-company-stale-tc", { isCompany: true, tcNo: "12345678901", taxOffice: "Kadıköy" }),
  owner("o-person-stale-tax", { isCompany: false, tcNo: "23456789012", taxOffice: "Üsküdar", signatoryTcNo: "333" }),
  owner("o-company-clean", { isCompany: true, taxOffice: "Kadıköy", taxNumber: "9990001112" }),
  owner("o-person-clean", { isCompany: false, tcNo: "34567890123" }),
];

const seededTenants: BackfillPerson[] = [
  tenant("t-company-stale-tc", { isCompany: true, tcNo: "45678901234" }),
  tenant("t-person-stale-tax", { isCompany: false, tcNo: "56789012345", taxNumber: "7770001112", signatoryName: "Elif" }),
  tenant("t-person-clean", { isCompany: false, tcNo: "67890123456" }),
];

const fail = (message: string): never => {
  console.error(`\n✗ BACKFILL SMOKE BAŞARISIZ: ${message}\n`);
  process.exit(1);
};

// --- Dry-run: sayımlar doğru, yazma yok ---
const dry = planBackfill(seededOwners, seededTenants, true);
const expected = {
  ownersClearedTc: 1,
  ownersClearedTax: 1,
  tenantsClearedTc: 1,
  tenantsClearedTax: 1,
  totalCleared: 4,
};
for (const [key, value] of Object.entries(expected)) {
  if (dry.summary[key as keyof typeof expected] !== value) {
    fail(`dry-run ${key} = ${dry.summary[key as keyof typeof expected]}, beklenen ${value}`);
  }
}
if (dry.writes.length !== 0) {
  fail(`dry-run ${dry.writes.length} yazma üretti — dry-run yazma üretmemeli`);
}

// --- Gerçek mod: yazmalar doğru tablolara ve alanlara gider ---
const real = planBackfill(seededOwners, seededTenants, false);
if (real.summary.totalCleared !== expected.totalCleared) {
  fail(`gerçek mod sayımı ${real.summary.totalCleared}, beklenen ${expected.totalCleared}`);
}
const writes = new Map(real.writes.map((w) => [`${w.table}:${String(w.id)}`, w.patch]));
if (JSON.stringify(writes.get("owners:o-company-stale-tc")) !== JSON.stringify({ tcNo: null })) {
  fail("şirket kaydından tcNo temizlenmedi");
}
if (!("taxOffice" in (writes.get("owners:o-person-stale-tax") ?? {}))) {
  fail("kişi kaydından vergi alanları temizlenmedi");
}
if (writes.has("owners:o-company-clean") || writes.has("owners:o-person-clean") || writes.has("tenants:t-person-clean")) {
  fail("temiz kayıtlar için yazma üretildi");
}

console.log(`
✓ BACKFILL SMOKE GEÇTİ — dry-run yazma yok, sayımlar doğru.

  Özet (dry-run):
    Malik · şirket → tcNo temizlenen : ${dry.summary.ownersClearedTc}
    Malik · kişi   → vergi temizlenen : ${dry.summary.ownersClearedTax}
    Kiracı · şirket → tcNo temizlenen : ${dry.summary.tenantsClearedTc}
    Kiracı · kişi   → vergi temizlenen : ${dry.summary.tenantsClearedTax}
    Toplam temizlenen kayıt            : ${dry.summary.totalCleared}
    Üretilen yazma (dry-run)           : ${dry.writes.length}

  Gerçek mod yazmaları: ${real.writes.length} kayıt etkilenecek.
  Sıradaki adım: bunx convex run backfill:stripStaleCompanyFields '{"dryRun":true}'
`);
process.exit(0);
