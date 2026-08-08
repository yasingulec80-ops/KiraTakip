import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

const crons = cronJobs();

// Her sabah 08:00'de, ayarlardaki pencereye ve alıcı tercihlerine göre
// vadesi gelen ve ödenmemiş kiralar için hatırlatma e-postası gönderir.
crons.cron(
  "daily-rent-reminders",
  "0 8 * * *",
  api.reminders.sendRentReminders,
  {},
);

// Vadesi gelen tahakkukları cari hesaplara işler, vadesi gelmemiş
// işlenmiş kayıtları temizler (vadesi gelmeyen borç cari hesaba yansımaz).
crons.cron(
  "daily-accrual-reconcile",
  "30 8 * * *",
  internal.accruals.reconcileAccrualLedgers,
  {},
);

export default crons;
