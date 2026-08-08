import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireActor } from "./ledger_helpers";
import { ROLES } from "./schema";

const REMINDER_SETTINGS_KEY = "reminders";

export const DEFAULT_REMINDER_SETTINGS = {
  daysBefore: 3,
  notifyTenant: true,
  notifyOwner: false,
};

/** Read the rent reminder preferences (window + recipients). */
export const getReminderSettings = query({
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", REMINDER_SETTINGS_KEY))
      .first();
    if (!doc) return DEFAULT_REMINDER_SETTINGS;
    return {
      daysBefore: doc.daysBefore ?? DEFAULT_REMINDER_SETTINGS.daysBefore,
      notifyTenant:
        doc.notifyTenant ?? DEFAULT_REMINDER_SETTINGS.notifyTenant,
      notifyOwner: doc.notifyOwner ?? DEFAULT_REMINDER_SETTINGS.notifyOwner,
    };
  },
});

/** Update the rent reminder preferences (admin only). */
export const updateReminderSettings = mutation({
  args: {
    daysBefore: v.number(),
    notifyTenant: v.boolean(),
    notifyOwner: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici hatırlatma ayarlarını değiştirebilir.");
    }

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", REMINDER_SETTINGS_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("settings", {
        key: REMINDER_SETTINGS_KEY,
        ...args,
      });
    }
    return true;
  },
});
