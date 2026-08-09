/**
 * Kişi ⇄ şirket dönüşüm temizliği kuralları — `backfill` mutation'ının saf
 * (pure) karar mantığı. Convex mutation'ı bu kuralları kullanır; tek kaynak
 * olduğu için birim test edilir.
 *
 * Kurallar:
 * - `isCompany === true` olan kayıtta eski kişisel `tcNo` varsa → sil (tc)
 * - `isCompany !== true` (kişi) kaydında şirket alanları
 *   (`taxOffice`/`taxNumber`/`signatoryName`/`signatoryTcNo`) varsa → sil (tax)
 * - ikisi de yoksa → dokunma
 *
 * `planBackfill` sayıları her iki modda aynı üretir; `dryRun: true` yalnızca
 * yazılacak yamaların listesini boş bırakır — mutation'ın yazabileceği hiçbir
 * şey kalmaz.
 */

export interface BackfillPerson {
  id: unknown; // Id<"owners"> | Id<"tenants">
  isCompany?: boolean;
  tcNo?: string | null;
  taxOffice?: string | null;
  taxNumber?: string | null;
  signatoryName?: string | null;
  signatoryTcNo?: string | null;
}

export type BackfillPatch =
  | { tcNo: null }
  | {
      taxOffice: null;
      taxNumber: null;
      signatoryName: null;
      signatoryTcNo: null;
    };

export type BackfillWrite = {
  table: "owners" | "tenants";
  id: unknown;
  patch: BackfillPatch;
};

/** Bayat alan varsa uygulanacak düzeltme yamasını döndürür; yoksa null. */
export const staleFieldsFor = (
  person: BackfillPerson,
): BackfillPatch | null => {
  if (person.isCompany === true && person.tcNo) {
    return { tcNo: null };
  }
  if (
    person.isCompany !== true &&
    (person.taxOffice ||
      person.taxNumber ||
      person.signatoryName ||
      person.signatoryTcNo)
  ) {
    return {
      taxOffice: null,
      taxNumber: null,
      signatoryName: null,
      signatoryTcNo: null,
    };
  }
  return null;
};

export interface BackfillSummary {
  ownersClearedTc: number;
  ownersClearedTax: number;
  tenantsClearedTc: number;
  tenantsClearedTax: number;
  totalCleared: number;
}

export interface BackfillPlan {
  summary: BackfillSummary;
  /**
   * Gerçek modda (`dryRun: false`) veritabanına yazılacak yamalar.
   * Dry-run'da her zaman boştur — yazılacak hiçbir şey üretilmez.
   */
  writes: BackfillWrite[];
}

const kindOf = (patch: BackfillPatch | null): "tc" | "tax" | null => {
  if (!patch) return null;
  return "tcNo" in patch ? "tc" : "tax";
};

/**
 * Backfill planı. Sayım her iki modda da aynı kod yolundan geçer; `dryRun`
 * yalnızca `writes` listesinin üretilip üretilmediğini belirler.
 */
export const planBackfill = (
  owners: BackfillPerson[],
  tenants: BackfillPerson[],
  dryRun: boolean,
): BackfillPlan => {
  let ownersClearedTc = 0;
  let ownersClearedTax = 0;
  let tenantsClearedTc = 0;
  let tenantsClearedTax = 0;
  const writes: BackfillWrite[] = [];

  for (const owner of owners) {
    const patch = staleFieldsFor(owner);
    const kind = kindOf(patch);
    if (kind === "tc") ownersClearedTc++;
    else if (kind === "tax") ownersClearedTax++;
    if (!dryRun && patch) {
      writes.push({ table: "owners", id: owner.id, patch });
    }
  }

  for (const tenant of tenants) {
    const patch = staleFieldsFor(tenant);
    const kind = kindOf(patch);
    if (kind === "tc") tenantsClearedTc++;
    else if (kind === "tax") tenantsClearedTax++;
    if (!dryRun && patch) {
      writes.push({ table: "tenants", id: tenant.id, patch });
    }
  }

  return {
    summary: {
      ownersClearedTc,
      ownersClearedTax,
      tenantsClearedTc,
      tenantsClearedTax,
      totalCleared:
        ownersClearedTc + ownersClearedTax + tenantsClearedTc + tenantsClearedTax,
    },
    writes,
  };
};
