import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ROLES, guarantorValidator } from "./schema";

/** Resolve the acting user, or null when not signed in. */
const getActor = async (ctx: any): Promise<Doc<"users"> | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
};

const tenantArgs = {
  name: v.string(),
  tcNo: v.optional(v.string()),
  phone: v.string(),
  address: v.string(),
  email: v.string(),
  guarantor: guarantorValidator,
  isCompany: v.optional(v.boolean()),
  taxOffice: v.optional(v.string()),
  taxNumber: v.optional(v.string()),
  signatoryName: v.optional(v.string()),
  signatoryTcNo: v.optional(v.string()),
};

/** List all tenants (authenticated users only). */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];
    return await ctx.db.query("tenants").collect();
  },
});

export const create = mutation({
  args: tenantArgs,
  handler: async (ctx, args) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");

    return await ctx.db.insert("tenants", {
      ...args,
      tcNo: args.tcNo ?? "",
      guarantor: args.guarantor ?? null,
      isCompany: args.isCompany ?? false,
      taxOffice: args.taxOffice,
      taxNumber: args.taxNumber,
      signatoryName: args.signatoryName,
      signatoryTcNo: args.signatoryTcNo,
      createdBy: user._id,
    });
  },
});

export const update = mutation({
  args: { id: v.id("tenants"), ...tenantArgs },
  handler: async (ctx, args) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");

    const tenant = await ctx.db.get(args.id);
    if (!tenant) throw new ConvexError("Kayıt bulunamadı.");

    const { id, ...data } = args;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) patch[key] = value;
    }
    patch.guarantor = data.guarantor ?? null;

    // Kişi ⇄ şirket dönüşümlerinde bayat alanları temizle:
    // - şirkete dönüştüyse eski TC bilgisi kaldırılır,
    // - kişiye dönüştüyse şirket bilgileri kaldırılır.
    if (data.isCompany === true) {
      patch.tcNo = null;
    } else if (data.isCompany === false) {
      patch.taxOffice = null;
      patch.taxNumber = null;
      patch.signatoryName = null;
      patch.signatoryTcNo = null;
    }

    await ctx.db.patch(id, patch as any);
  },
});

export const remove = mutation({
  args: { id: v.id("tenants") },
  handler: async (ctx, { id }) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");
    if (user.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici kiracı silebilir.");
    }
    const tenant = await ctx.db.get(id);
    if (!tenant) throw new ConvexError("Kayıt bulunamadı.");

    await ctx.db.delete(id);
  },
});
