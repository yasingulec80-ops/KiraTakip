import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  QueryCtx,
} from "./_generated/server";
import { ROLES, roleValidator, type Role } from "./schema";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return user;
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

const ADMIN_USERNAME = "Admin";
const ADMIN_PASSWORD = "8842";

/** Call the internal auth:store mutation to create a password account. */
const createPasswordAccount = async (
  ctx: any,
  accountId: string,
  secret: string,
  profile: Record<string, unknown>,
) => {
  await ctx.runMutation("auth:store", {
    args: {
      type: "createAccountFromCredentials",
      provider: "password",
      account: { id: accountId, secret },
      profile,
    },
  });
};

/** Call the internal auth:store mutation to change a password account's secret. */
const modifyPasswordAccount = async (
  ctx: any,
  accountId: string,
  secret: string,
) => {
  await ctx.runMutation("auth:store", {
    args: {
      type: "modifyAccount",
      provider: "password",
      account: { id: accountId, secret },
    },
  });
};

/**
 * Seed the initial admin user (Admin / 8842) on first run.
 * Idempotent: does nothing once any password account exists.
 * Called from the login screen.
 */
export const ensureInitialAdmin = mutation({
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password"))
      .first();

    if (existing !== null) {
      return { created: false };
    }

    await createPasswordAccount(ctx, ADMIN_USERNAME, ADMIN_PASSWORD, {
      email: ADMIN_USERNAME,
      name: "Yönetici",
      role: ROLES.ADMIN,
      isActive: true,
      authorizedPropertyIds: [],
    });

    return { created: true };
  },
});

export interface UserSummary {
  _id: string;
  _creationTime: number;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  authorizedPropertyIds: string[];
  isAdmin: boolean;
}

/** List all users (admin only). */
export const listUsers = query({
  handler: async (ctx): Promise<UserSummary[]> => {
    const actor = await getCurrentUser(ctx);
    if (!actor || actor.role !== ROLES.ADMIN) return [];

    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.email !== undefined || u.isAnonymous !== true)
      .map((u) => ({
        _id: u._id,
        _creationTime: u._creationTime,
        name: u.name ?? "",
        username: u.email ?? "",
        role: (u.role ?? ROLES.MANAGER) as Role,
        isActive: u.isActive !== false,
        authorizedPropertyIds: (u.authorizedPropertyIds ?? []).map((id) =>
          id.toString(),
        ),
        isAdmin: u.role === ROLES.ADMIN,
      }));
  },
});

/** Create a new user with username + password (admin only). */
export const createUser = mutation({
  args: {
    username: v.string(),
    password: v.string(),
    name: v.string(),
    role: roleValidator,
    authorizedPropertyIds: v.array(v.id("properties")),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await getCurrentUser(ctx);
    if (!actor || actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici kullanıcı oluşturabilir.");
    }

    const username = args.username.trim();
    if (username.length === 0 || args.password.length === 0) {
      throw new ConvexError("Kullanıcı adı ve şifre zorunludur.");
    }

    const existing = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", username),
      )
      .unique();
    if (existing !== null) {
      throw new ConvexError("Bu kullanıcı adı zaten kayıtlı.");
    }

    await createPasswordAccount(ctx, username, args.password, {
      email: username,
      name: args.name.trim(),
      role: args.role,
      isActive: args.isActive,
      authorizedPropertyIds: args.authorizedPropertyIds,
    });
  },
});

/** Update a user's name, role, property access, active state or password (admin only). */
export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    role: v.optional(roleValidator),
    authorizedPropertyIds: v.optional(v.array(v.id("properties"))),
    isActive: v.optional(v.boolean()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getCurrentUser(ctx);
    if (!actor || actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici kullanıcı düzenleyebilir.");
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("Kullanıcı bulunamadı.");

    // Protect the seeded admin account from being deactivated.
    if (target.email === ADMIN_USERNAME && args.isActive === false) {
      throw new ConvexError("Yönetici hesabı pasife alınamaz.");
    }

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.role !== undefined) patch.role = args.role;
    if (args.authorizedPropertyIds !== undefined)
      patch.authorizedPropertyIds = args.authorizedPropertyIds;
    if (args.isActive !== undefined) patch.isActive = args.isActive;

    if (args.password !== undefined && args.password.length > 0) {
      if (!target.email) throw new ConvexError("Kullanıcının giriş adı yok.");
      await modifyPasswordAccount(ctx, target.email, args.password);
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(target._id, patch as any);
    }
  },
});

/** Delete a user (admin only). The seeded admin and the acting admin cannot be deleted. */
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const actor = await getCurrentUser(ctx);
    if (!actor || actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici kullanıcı silebilir.");
    }
    if (userId === actor._id) {
      throw new ConvexError("Kendi hesabınızı silemezsiniz.");
    }

    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError("Kullanıcı bulunamadı.");
    if (target.email === ADMIN_USERNAME) {
      throw new ConvexError("Yönetici hesabı silinemez.");
    }

    // Remove auth accounts for this user (password provider rows).
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const account of accounts) {
      await ctx.db.delete(account._id);
    }

    await ctx.db.delete(userId);
  },
});
