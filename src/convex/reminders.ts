"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { createVlyIntegrations } from "@vly-ai/integrations";
import { v } from "convex/values";

const formatAmount = (value: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);

const formatDate = (ts: number) =>
  new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(ts);

const esc = (value: string | number | null | undefined) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const buildEmailHtml = (row: {
  tenantName: string;
  propertyName: string;
  period: string;
  amount: number;
  dueDate: number;
}): string => `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; margin: 0 auto; color: #2b2722;">
  <div style="border-bottom: 1.5px solid #2b2722; padding-bottom: 12px; margin-bottom: 24px;">
    <p style="margin: 0; font-size: 18px; letter-spacing: 0.02em;">Kira Takip</p>
    <p style="margin: 4px 0 0; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #6b6358;">Gayrimenkul Yönetim Paneli</p>
  </div>
  <p style="font-size: 15px; line-height: 1.8;">Merhaba ${esc(row.tenantName)},</p>
  <p style="font-size: 15px; line-height: 1.8;">
    <strong>${esc(row.propertyName)}</strong> adresindeki kiracılığınıza ait
    <strong>${esc(row.period)}</strong> dönemi kira ödemesi için hatırlatma yapıyoruz.
  </p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
    <tr>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; color: #6b6358;">Dönem</td>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; text-align: right;">${esc(row.period)}</td>
    </tr>
    <tr>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; color: #6b6358;">Kira Tutarı</td>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; text-align: right;">${esc(formatAmount(row.amount))} ₺</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #6b6358;">Son Ödeme Tarihi</td>
      <td style="padding: 8px 0; text-align: right;">${esc(formatDate(row.dueDate))}</td>
    </tr>
  </table>
  <p style="font-size: 14px; line-height: 1.8; color: #6b6358;">
    Ödemenizi zamanında gerçekleştirmenizi rica ederiz. Herhangi bir sorunuz varsa
    yöneticinizle iletişime geçebilirsiniz.
  </p>
  <p style="margin-top: 32px; font-size: 12px; color: #6b6358; border-top: 1px solid #e3ddd2; padding-top: 12px;">
    Bu e-posta Kira Takip tarafından otomatik olarak gönderilmiştir.
  </p>
</div>`;

/**
 * Send rent reminders for upcoming unpaid accruals through the platform's
 * email gateway (vly.email.send, billed via VLY_INTEGRATION_KEY).
 * Returns { configured, sent, failed } so the UI can report the result.
 */
export const sendRentReminders = action({
  args: { daysBefore: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const daysBefore = Math.max(1, Math.min(30, args.daysBefore ?? 3));
    const token = process.env.VLY_INTEGRATION_KEY;
    if (!token) {
      return { configured: false, sent: 0, failed: 0 };
    }

    const vly = createVlyIntegrations({ deploymentToken: token });
    const rows = await ctx.runQuery(internal.reminder_data.listDueAccruals, {
      daysBefore,
    });

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const result = await vly.email.send({
          to: row.tenantEmail,
          subject: `Kira hatırlatması — ${row.propertyName} · ${row.period}`,
          html: buildEmailHtml(row),
        });
        if (!result.success || result.data?.status === "failed") {
          failed += 1;
          continue;
        }
      } catch {
        failed += 1;
        continue;
      }
      await ctx.runMutation(internal.reminder_data.logReminderSent, {
        accrualId: row.accrualId,
        recipientEmail: row.tenantEmail,
      });
      sent += 1;
    }

    return { configured: true, sent, failed };
  },
});
