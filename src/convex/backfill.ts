import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { ROLES } from "./schema";
import { planBackfill } from "../lib/backfill-rules";

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
 * Karar mantığı `src/lib/backfill-rules.ts` içindeki saf fonksiyonlardan gelir
 * (tek kaynak, birim testli). Yalnızca yönetici çalıştırabilir.
 *
 * Çağrılar:
 *   bun run backfill:smoke                                             → yerel dry-run smoke check (veritabanına yazmaz)
 *   bunx convex run backfill:stripStaleCompanyFields '{"dryRun":true}' → sadece sayar, yazmaz
 *   bunx convex run backfill:stripStaleCompanyFields                    → gerçek temizlik
 * Güvenli: zaten doğru olan kayıtlara dokunmaz; `dryRun: true` hiçbir şey yazmaz.
 *
 * Smoke check akışı (tohumlanmış veriyle):
 *   1. bun run backfill:smoke            → yerel, tohumlanmış veriyle planBackfill'i doğrular (yazma yok)
 *   2. bunx convex run seed:seedDemoData → gerçek ortamda demo verisi
 *   3. bunx convex run backfill:stripStaleCompanyFields '{"dryRun":true}' → gerçek ortamda ön rapor
 *   4. sayılar beklenen gibiyse gerçek temizlik (adım 3'teki komut dryRun'suz)
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

    const owners = await ctx.db.query("owners").collect();
    const tenants = await ctx.db.query("tenants").collect();

    const plan = planBackfill(
      owners.map((o) => ({ id: o._id, ...o })),
      tenants.map((t) => ({ id: t._id, ...t })),
      dryRun,
    );

    // Dry-run'da plan hiç yama üretmez — bu döngü çalışacak hiçbir şey bulamaz.
    if (!dryRun) {
      for (const write of plan.writes) {
        await ctx.db.patch(write.id as never, write.patch as never);
      }
    }

    return { dryRun, ...plan.summary };
  },
});
