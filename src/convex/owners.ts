import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ROLES, proxyValidator } from "./schema";

/** Resolve the acting user, or null when not signed in. */
const getActor = async (ctx: any): Promise<Doc<"users"> | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
};

const ownerArgs = {
  name: v.string(),
  tcNo: v.string(),
  phone: v.string(),
  address: v.string(),
  email: v.string(),
  bankName: v.string(),
  iban: v.string(),
  proxy: proxyValidator,
};

/** List all owners (authenticated users only). */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];
    return await ctx.db.query("owners").collect();
  },
});

export const create = mutation({
  args: ownerArgs,
  handler: async (ctx, args) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");

    return await ctx.db.insert("owners", {
      ...args,
      proxy: args.proxy ?? null,
      createdBy: user._id,
    });
  },
});

export const update = mutation({
  args: { id: v.id("owners"), ...ownerArgs },
  handler: async (ctx, args) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");

    const owner = await ctx.db.get(args.id);
    if (!owner) throw new ConvexError("Kayıt bulunamadı.");

    const { id, ...data } = args;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) patch[key] = value;
    }
    patch.proxy = data.proxy ?? null;

    await ctx.db.patch(id, patch as any);
  },
});

export const remove = mutation({
  args: { id: v.id("owners") },
  handler: async (ctx, { id }) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");
    if (user.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici malik silebilir.");
    }
    const owner = await ctx.db.get(id);
    if (!owner) throw new ConvexError("Kayıt bulunamadı.");

    // Unlink the owner from any properties before deleting.
    const linked = await ctx.db
      .query("properties")
      .withIndex("by_owner", (q) => q.eq("ownerId", id))
      .collect();
    for (const property of linked) {
      await ctx.db.patch(property._id, { ownerId: undefined as any });
    }

    await ctx.db.delete(id);
  },
});
