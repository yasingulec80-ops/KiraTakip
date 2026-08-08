import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Her sabah 08:00'de, ayarlardaki pencereye ve alıcı tercihlerine göre
// vadesi gelen ve ödenmemiş kiralar için hatırlatma e-postası gönderir.
crons.cron(
  "daily-rent-reminders",
  "0 8 * * *",
  api.reminders.sendRentReminders,
  {},
);

export default crons;
