import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { ROLES } from "./schema";

/**
 * ONE-TIME BACKFILL — kişi ⇄ şirket dönüşüm temizliği.
 *
 * Daha önce "kişi → şirket" ya da "şirket → kişi" dönüşümleri yapılmış
 * kayıtlarda bayat kalan alanları temizler:
 *
 * - `isCompany === true`  olan malik/kiracı kayıtlarında eski kişisel `tcNo`
 *   varsa silinir (şirketin TC'si olmaz; imza yetkilisi TC ayrı alandadır).
 * - `isCompany !== true` (kişi) kayıtlarında şirket alanları
 *   (`taxOffice`, `taxNumber`, `signatoryName`, `signatoryTcNo`) varsa silinir.
 *
 * Yalnızca yönetici çalıştırabilir ve yalnızca gerçekten değişiklik gereken
 * kayıtları günceller. Kimlik doğrulama gerektirir (oturum açık olmalıdır).
 *
 * Çağrılar:
 *   bunx convex run backfill:stripStaleCompanyFields '{"dryRun":true}'  → sadece sayar, yazmaz
 *   bunx convex run backfill:stripStaleCompanyFields                    → gerçek temizlik
 * Güvenli: zaten doğru olan kayıtlara dokunmaz; `dryRun: true` hiçbir şey yazmaz.
 */
export const stripStaleCompanyFields = mutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const userId = await getAuthUserId(ctx);
    const actor = userId ? await ctx.db.get(userId) : null;
    if (!actor || actor.role !== ROLES.ADMIN) {
      throw new ConvexError(
        "Yalnızca yönetici bu temizlik işlemini çalıştırabilir.",
      );
    }

    let ownersClearedTc = 0;
    let ownersClearedTax = 0;
    let tenantsClearedTc = 0;
    let tenantsClearedTax = 0;

    /* ----------------------------- Malikler ----------------------------- */
    const owners = await ctx.db.query("owners").collect();
    for (const owner of owners) {
      if (owner.isCompany === true && owner.tcNo) {
        if (!dryRun) await ctx.db.patch(owner._id, { tcNo: null as any });
        ownersClearedTc++;
      } else if (
        owner.isCompany !== true &&
        (owner.taxOffice || owner.taxNumber || owner.signatoryName || owner.signatoryTcNo)
      ) {
        if (!dryRun) {
          await ctx.db.patch(owner._id, {
            taxOffice: null as any,
            taxNumber: null as any,
            signatoryName: null as any,
            signatoryTcNo: null as any,
          });
        }
        ownersClearedTax++;
      }
    }

    /* ----------------------------- Kiracılar ---------------------------- */
    const tenants = await ctx.db.query("tenants").collect();
    for (const tenant of tenants) {
      if (tenant.isCompany === true && tenant.tcNo) {
        if (!dryRun) await ctx.db.patch(tenant._id, { tcNo: null as any });
        tenantsClearedTc++;
      } else if (
        tenant.isCompany !== true &&
        (tenant.taxOffice || tenant.taxNumber || tenant.signatoryName || tenant.signatoryTcNo)
      ) {
        if (!dryRun) {
          await ctx.db.patch(tenant._id, {
            taxOffice: null as any,
            taxNumber: null as any,
            signatoryName: null as any,
            signatoryTcNo: null as any,
          });
        }
        tenantsClearedTax++;
      }
    }

    return {
      dryRun,
      ownersClearedTc,
      ownersClearedTax,
      tenantsClearedTc,
      tenantsClearedTax,
      totalCleared: ownersClearedTc + ownersClearedTax + tenantsClearedTc + tenantsClearedTax,
    };
  },
});
