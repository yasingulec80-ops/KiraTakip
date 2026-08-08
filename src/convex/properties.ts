import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ROLES, fixtureValidator } from "./schema";

/** Resolve the acting user, or null when not signed in. */
const getActor = async (ctx: any): Promise<Doc<"users"> | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
};

const propertyArgs = {
  ownerId: v.optional(v.id("owners")),
  name: v.string(),
  address: v.string(),
  m2: v.optional(v.number()),
  roomCount: v.optional(v.string()),
  facade: v.optional(v.string()),
  electricityMeter: v.optional(v.string()),
  waterMeter: v.optional(v.string()),
  gasMeter: v.optional(v.string()),
  fixtures: v.optional(v.array(fixtureValidator)),
  notes: v.optional(v.string()),
};

/** List properties the current user is authorized to see. Admins see all. */
export const list = query({
  handler: async (ctx) => {
    const user = await getActor(ctx);
    if (!user || user.isActive === false) return [];

    const all = await ctx.db.query("properties").collect();

    if (user.role === ROLES.ADMIN) return all;

    const authorized = new Set(
      (user.authorizedPropertyIds ?? []).map((id) => id.toString()),
    );
    return all.filter((p) => authorized.has(p._id.toString()));
  },
});

/** Create a property. Managers get the new property added to their access list. */
export const create = mutation({
  args: propertyArgs,
  handler: async (ctx, args) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");

    const id = await ctx.db.insert("properties", {
      ...args,
      fixtures: args.fixtures ?? [],
      createdBy: user._id,
    });

    // A manager who registers a property automatically gains access to it.
    if (user.role !== ROLES.ADMIN) {
      await ctx.db.patch(user._id, {
        authorizedPropertyIds: [
          ...(user.authorizedPropertyIds ?? []),
          id,
        ],
      });
    }

    return id;
  },
});

/** Update a property. Requires admin role or access to that property. */
export const update = mutation({
  args: { id: v.id("properties"), ...propertyArgs },
  handler: async (ctx, args) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");

    const property = await ctx.db.get(args.id);
    if (!property) throw new ConvexError("Kayıt bulunamadı.");

    const isAdmin = user.role === ROLES.ADMIN;
    const hasAccess = (user.authorizedPropertyIds ?? []).some(
      (pid) => pid === args.id,
    );
    if (!isAdmin && !hasAccess) {
      throw new ConvexError("Bu gayrimenkule erişim yetkiniz yok.");
    }

    const { id, ...data } = args;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) patch[key] = value;
    }
    patch.fixtures = data.fixtures ?? [];

    await ctx.db.patch(id, patch as any);
  },
});

/** Delete a property (admin only). Also strips it from users' access lists. */
export const remove = mutation({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    const user = await getActor(ctx);
    if (!user) throw new ConvexError("Giriş yapmalısınız.");
    if (user.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici gayrimenkul silebilir.");
    }

    const property = await ctx.db.get(id);
    if (!property) throw new ConvexError("Kayıt bulunamadı.");

    await ctx.db.delete(id);

    // Remove the id from every user's authorizedPropertyIds.
    const allUsers = await ctx.db.query("users").collect();
    for (const u of allUsers) {
      const list = (u.authorizedPropertyIds ?? []).filter((pid) => pid !== id);
      if (list.length !== (u.authorizedPropertyIds ?? []).length) {
        await ctx.db.patch(u._id, { authorizedPropertyIds: list });
      }
    }
  },
});
