import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Her sabah 08:00'de, 3 gün içinde vadesi gelen ve ödenmemiş kiralar için
// kiracılara hatırlatma e-postası gönderir.
crons.cron(
  "daily-rent-reminders",
  "0 8 * * *",
  api.reminders.sendRentReminders,
  { daysBefore: 3 },
);

export default crons;
