#!/usr/bin/env bun
/**
 * Backfill dry-run smoke check.
 *
 * `bunx convex run backfill:stripStaleCompanyFields '{"dryRun":true}'`
 * komutunun çıktısını, gerçek mutation'ın kullandığı planBackfill fonksiyonunu
 * tohumlanmış (seeded) bir veri kümesi üzerinde çalıştırarak doğrular —
 * veritabanına hiçbir şey yazmaz.
 *
 * Tohumlanan veri, seed.ts'in ürettiği kayıtların birebir şeklini içerir:
 *   • temiz kişi malik/kiracı (seed.ts kayıtları)
 *   • kişi → şirket dönüşümü yapılmış, bayat `tcNo` taşıyan şirketler
 *   • şirket → kişi dönüşümü yapılmış, bayat şirket alanı taşıyan kişiler
 *   • temiz şirket ve temiz kişi (dokunulmaması gerekenler)
 *
 * Çalıştırma: bun run backfill:smoke
 */
import { planBackfill, type BackfillPerson } from "../src/lib/backfill-rules";

let failed = false;
const check = (cond: boolean, label: string): void => {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failed = true;
    console.error(`  ✖ FAIL — ${label}`);
  }
};

/* ----------------------- Tohumlanmış veri kümesi ----------------------- */

const owners: BackfillPerson[] = [
  // seed.ts maliki "Ahmet Yılmaz" — kişi, temiz (dokunulmamalı)
  { id: "o-seed-ahmet", isCompany: false, tcNo: "12345678901" },
  // kişi → şirket dönüşümü: bayat kişisel TC hâlâ üzerinde
  {
    id: "o-co-stale",
    isCompany: true,
    tcNo: "11111111111",
    taxOffice: "İstanbul VD",
    taxNumber: "9990011223",
    signatoryName: "Ayşe Yönetici",
    signatoryTcNo: "10987654321",
  },
  // şirket → kişi dönüşümü: şirket alanları hâlâ üzerinde
  {
    id: "o-p-stale",
    isCompany: false,
    tcNo: "22222222222",
    taxOffice: "Ankara VD",
    taxNumber: "8880001122",
    signatoryName: "Eski Yetkili",
    signatoryTcNo: "33333333333",
  },
  // temiz şirket — TC'si yok, şirket alanları geçerli (dokunulmamalı)
  {
    id: "o-co-clean",
    isCompany: true,
    taxOffice: "İzmir VD",
    taxNumber: "7770003344",
    signatoryName: "Zeynep Yönetici",
    signatoryTcNo: "44444444444",
  },
];

const tenants: BackfillPerson[] = [
  // seed.ts kiracısı "Elif Demir" — kişi, temiz (dokunulmamalı)
  { id: "t-seed-elif", isCompany: false, tcNo: "23456789012" },
  // kişi → şirket dönüşümü: bayat TC hâlâ üzerinde
  {
    id: "t-co-stale",
    isCompany: true,
    tcNo: "55555555555",
    taxOffice: "Bursa VD",
    taxNumber: "6660004455",
    signatoryName: "Murat Yönetici",
    signatoryTcNo: "66666666666",
  },
  // şirket → kişi dönüşümü: şirket alanları hâlâ üzerinde
  { id: "t-p-stale", isCompany: false, tcNo: "77777777777", taxNumber: "4440005566" },
  // temiz kişi (dokunulmamalı)
  { id: "t-p-clean", isCompany: false, tcNo: "88888888888" },
];

/* ------------------------------ Dry-run ------------------------------- */

console.log("Dry-run smoke check — backfill:stripStaleCompanyFields\n");

const dry = planBackfill(owners, tenants, true);
check(dry.writes.length === 0, "dry-run hiçbir yama üretmedi (yazma yok)");

const real = planBackfill(owners, tenants, false);
check(
  JSON.stringify(dry.summary) === JSON.stringify(real.summary),
  "dry-run sayımı gerçek modla birebir aynı",
);

check(
  dry.summary.ownersClearedTc === 1 &&
    dry.summary.ownersClearedTax === 1 &&
    dry.summary.tenantsClearedTc === 1 &&
    dry.summary.tenantsClearedTax === 1 &&
    dry.summary.totalCleared === 4,
  `beklenen 4 bayat kayıt tespit edildi (şirket: 2 tc / kişi: 2 tax) → toplam ${dry.summary.totalCleared}`,
);

/* --------------------------- Yama hedefleri --------------------------- */

const tcWrites = real.writes.filter((w) => "tcNo" in w.patch);
const taxWrites = real.writes.filter((w) => "taxOffice" in w.patch);

check(
  tcWrites.length === 2 &&
    tcWrites.every((w) => w.id.startsWith("o-") || w.id.startsWith("t-")) &&
    tcWrites.map((w) => w.id).sort().join(",") === "o-co-stale,t-co-stale",
  "tc yamaları yalnızca şirket kayıtlarına (o-co-stale, t-co-stale)",
);
check(
  taxWrites.length === 2 &&
    taxWrites.map((w) => w.id).sort().join(",") === "o-p-stale,t-p-stale",
  "tax yamaları yalnızca kişi kayıtlarına (o-p-stale, t-p-stale)",
);

const writtenIds = real.writes.map((w) => w.id);
check(
  !writtenIds.includes("o-seed-ahmet") &&
    !writtenIds.includes("t-seed-elif") &&
    !writtenIds.includes("o-co-clean") &&
    !writtenIds.includes("t-p-clean"),
  "temiz / seed kayıtlarına dokunulmuyor",
);

/* ------------ Gerçek mod yamalarını bellek üzerinde uygula ------------ */

for (const w of real.writes) {
  const row = [...owners, ...tenants].find((r) => r.id === w.id);
  if (row) Object.assign(row, w.patch);
}

const byId = (id: string) => [...owners, ...tenants].find((r) => r.id === id)!;

check(byId("o-co-stale").tcNo == null, "şirket malikten bayat tcNo silindi");
check(
  byId("o-p-stale").taxOffice == null &&
    byId("o-p-stale").taxNumber == null &&
    byId("o-p-stale").signatoryName == null &&
    byId("o-p-stale").signatoryTcNo == null,
  "kişi malikten bayat şirket alanları silindi",
);
check(byId("o-co-stale").taxOffice === "İstanbul VD", "şirket malikin geçerli şirket alanları korundu");
check(byId("o-co-clean").taxOffice === "İzmir VD", "temiz şirket dokunulmadan duruyor");
check(byId("o-seed-ahmet").tcNo === "12345678901", "seed malik (kişi) aynen duruyor");
check(byId("t-co-stale").tcNo == null, "şirket kiracıdan bayat tcNo silindi");
check(byId("t-p-stale").taxNumber == null, "kişi kiracıdan bayat şirket alanı silindi");
check(byId("t-seed-elif").tcNo === "23456789012" && byId("t-p-clean").tcNo === "88888888888", "seed/temiz kiracılar aynen duruyor");

/* ------------------------------- Rapor -------------------------------- */

console.log("\nDry-run raporu — `bunx convex run backfill:stripStaleCompanyFields '{\"dryRun\":true}'` çıktısı:");
console.log(JSON.stringify({ dryRun: true, ...dry.summary }, null, 2));

if (failed) {
  console.error("\nSmoke check FAILED.");
  process.exit(1);
}
console.log("\nSmoke check PASSED — backfill dry-run tohumlanmış veride doğru çalışıyor, hiçbir şey yazmadı.");
