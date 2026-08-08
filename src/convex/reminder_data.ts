import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;

interface DueAccrual {
  accrualId: string;
  period: string;
  amount: number;
  dueDate: number;
  propertyName: string;
  tenantName: string;
  tenantEmail: string;
  ownerName: string;
  ownerEmail: string;
  /** Recipient emails already reminded for this accrual (dedupe). */
  alreadySent: string[];
}

/** Upcoming unpaid accruals (due within N days) with recipient contact info. */
export const listDueAccruals = internalQuery({
  args: { daysBefore: v.number() },
  handler: async (ctx, { daysBefore }) => {
    const now = Date.now();
    const windowEnd = now + daysBefore * DAY_MS;

    const accruals = await ctx.db.query("accruals").collect();
    const due = accruals
      .filter(
        (a) =>
          (a.type ?? "rent") !== "deposit" && // depozito tahakkukları için hatırlatma gönderilmez
          (a.status ?? "pending") !== "paid" &&
          a.dueDate >= now &&
          a.dueDate <= windowEnd,
      )
      .sort((a, b) => a.dueDate - b.dueDate);

    const rows: DueAccrual[] = [];
    for (const accrual of due) {
      const contract = await ctx.db.get(accrual.contractId);
      if (!contract || contract.status === "ended") continue;

      const tenant = await ctx.db.get(contract.tenantId);
      const owner = await ctx.db.get(contract.ownerId);
      if (!tenant?.email && !owner?.email) continue;

      const logs = await ctx.db
        .query("reminderLogs")
        .withIndex("by_accrual", (q) => q.eq("accrualId", accrual._id))
        .collect();

      const property = await ctx.db.get(contract.propertyId);
      rows.push({
        accrualId: accrual._id.toString(),
        period: accrual.period,
        amount: accrual.amount,
        dueDate: accrual.dueDate,
        propertyName: property?.name ?? "Gayrimenkul",
        tenantName: tenant?.name ?? "Kiracı",
        tenantEmail: tenant?.email ?? "",
        ownerName: owner?.name ?? "Malik",
        ownerEmail: owner?.email ?? "",
        alreadySent: logs.map((log) => log.recipientEmail),
      });
    }
    return rows;
  },
});

/** Record a sent reminder so the same accrual+recipient is not emailed twice. */
export const logReminderSent = internalMutation({
  args: {
    accrualId: v.string(),
    recipientEmail: v.string(),
  },
  handler: async (ctx, { accrualId, recipientEmail }) => {
    await ctx.db.insert("reminderLogs", {
      accrualId: accrualId as Id<"accruals">,
      recipientEmail,
      sentAt: Date.now(),
    });
  },
});
