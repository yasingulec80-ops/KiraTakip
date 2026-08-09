"use node";

import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
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
  recipientName: string;
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
  <p style="font-size: 15px; line-height: 1.8;">Merhaba ${esc(row.recipientName)},</p>
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
 * The reminder window and recipients come from the reminder settings
 * (an explicit daysBefore argument overrides the configured window).
 * Returns { configured, sent, failed } so the UI can report the result.
 */
export const sendRentReminders = action({
  args: { daysBefore: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const token = process.env.VLY_INTEGRATION_KEY;
    if (!token) {
      return { configured: false, sent: 0, failed: 0 };
    }

    const settings = await ctx.runQuery(api.settings.getReminderSettings);
    const daysBefore =
      args.daysBefore !== undefined
        ? Math.max(1, Math.min(30, args.daysBefore))
        : settings.daysBefore;

    const vly = createVlyIntegrations({ deploymentToken: token });
    const rows = await ctx.runQuery(internal.reminder_data.listDueAccruals, {
      daysBefore,
    });

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const recipients: { email: string; name: string }[] = [];
      if (settings.notifyTenant && row.tenantEmail) {
        recipients.push({ email: row.tenantEmail, name: row.tenantName });
      }
      if (settings.notifyOwner && row.ownerEmail) {
        recipients.push({ email: row.ownerEmail, name: row.ownerName });
      }

      for (const recipient of recipients) {
        if (row.alreadySent.includes(recipient.email)) continue;
        try {
          const result = await vly.email.send({
            to: recipient.email,
            subject: `Kira hatırlatması — ${row.propertyName} · ${row.period}`,
            html: buildEmailHtml({
              recipientName: recipient.name,
              propertyName: row.propertyName,
              period: row.period,
              amount: row.amount,
              dueDate: row.dueDate,
            }),
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
          recipientEmail: recipient.email,
        });
        sent += 1;
      }
    }

    return { configured: true, sent, failed };
  },
});

/* ------------------- Kira artışı bildirimi e-postası ------------------- */

const buildIncreaseEmailHtml = (row: {
  recipientName: string;
  propertyName: string;
  isOwner: boolean;
  oldRent: number;
  newRent: number;
  rate: number;
  effectiveDate: number;
  nextIncreaseDate?: number;
}): string => {
  const intro = row.isOwner
    ? `<strong>${esc(row.propertyName)}</strong> adresindeki gayrimenkulünüzün aylık kira tutarı güncellenmiştir.`
    : `<strong>${esc(row.propertyName)}</strong> adresindeki kiraladığınız konutun aylık kira tutarı güncellenmiştir.`;
  const nextLine = row.nextIncreaseDate
    ? `<tr>
      <td style="padding: 8px 0; color: #6b6358;">Sonraki Artış Dönemi</td>
      <td style="padding: 8px 0; text-align: right;">${esc(formatDate(row.nextIncreaseDate))}</td>
    </tr>`
    : "";
  return `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; margin: 0 auto; color: #2b2722;">
  <div style="border-bottom: 1.5px solid #2b2722; padding-bottom: 12px; margin-bottom: 24px;">
    <p style="margin: 0; font-size: 18px; letter-spacing: 0.02em;">Kira Takip</p>
    <p style="margin: 4px 0 0; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #6b6358;">Gayrimenkul Yönetim Paneli</p>
  </div>
  <p style="font-size: 15px; line-height: 1.8;">Merhaba ${esc(row.recipientName)},</p>
  <p style="font-size: 15px; line-height: 1.8;">${intro}</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
    <tr>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; color: #6b6358;">Eski Kira</td>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; text-align: right;">${esc(formatAmount(row.oldRent))} ₺</td>
    </tr>
    <tr>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; color: #6b6358;">Yeni Kira</td>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; text-align: right;"><strong>${esc(formatAmount(row.newRent))} ₺</strong></td>
    </tr>
    <tr>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; color: #6b6358;">Artış Oranı</td>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; text-align: right;">%${esc(row.rate)}</td>
    </tr>
    <tr>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; color: #6b6358;">Uygulanma Tarihi</td>
      <td style="border-bottom: 1px solid #e3ddd2; padding: 8px 0; text-align: right;">${esc(formatDate(row.effectiveDate))}</td>
    </tr>
    ${nextLine}
  </table>
  <p style="font-size: 14px; line-height: 1.8; color: #6b6358;">
    Güncel kira tutarı ${esc(formatDate(row.effectiveDate))} tarihinden itibaren geçerli olacaktır.
    Herhangi bir sorunuz varsa yöneticinizle iletişime geçebilirsiniz.
  </p>
  <p style="margin-top: 32px; font-size: 12px; color: #6b6358; border-top: 1px solid #e3ddd2; padding-top: 12px;">
    Bu e-posta Kira Takip tarafından otomatik olarak gönderilmiştir.
  </p>
</div>`;
};

/**
 * Kira artışı uygulandığında malik ve kiracıya e-posta bildirimi.
 * `applyRentIncrease` mutation'ı commit olduktan sonra scheduler ile tetikler.
 * VLY_INTEGRATION_KEY yapılandırılmamışsa sessizce atlanır (configured: false).
 */
export const sendRentIncreaseNotification = internalAction({
  args: {
    propertyName: v.string(),
    tenantName: v.string(),
    tenantEmail: v.optional(v.string()),
    ownerName: v.string(),
    ownerEmail: v.optional(v.string()),
    oldRent: v.number(),
    newRent: v.number(),
    rate: v.number(),
    effectiveDate: v.number(),
    nextIncreaseDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = process.env.VLY_INTEGRATION_KEY;
    if (!token) return { configured: false, sent: 0, failed: 0 };

    const vly = createVlyIntegrations({ deploymentToken: token });
    const recipients: { email: string; name: string; isOwner: boolean }[] = [];
    if (args.tenantEmail) {
      recipients.push({
        email: args.tenantEmail,
        name: args.tenantName,
        isOwner: false,
      });
    }
    if (args.ownerEmail) {
      recipients.push({ email: args.ownerEmail, name: args.ownerName, isOwner: true });
    }

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        const result = await vly.email.send({
          to: recipient.email,
          subject: `Kira artışı bildirimi — ${args.propertyName}`,
          html: buildIncreaseEmailHtml({
            recipientName: recipient.name,
            propertyName: args.propertyName,
            isOwner: recipient.isOwner,
            oldRent: args.oldRent,
            newRent: args.newRent,
            rate: args.rate,
            effectiveDate: args.effectiveDate,
            nextIncreaseDate: args.nextIncreaseDate,
          }),
        });
        if (!result.success || result.data?.status === "failed") {
          failed += 1;
          continue;
        }
      } catch {
        failed += 1;
        continue;
      }
      sent += 1;
    }

    return { configured: true, sent, failed };
  },
});
