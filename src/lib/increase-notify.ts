/**
 * Kira artışı e-posta bildirimi — alıcı seçim kuralının saf (pure) uygulaması.
 * `applyRentIncrease` mutation'ı bu kuralı kullanır; tek kaynak olduğu için
 * birim test edilir.
 */

export interface IncreaseNotifyPerson {
  name?: string | null;
  email?: string | null;
}

export interface IncreaseNotifyRecipient {
  email: string;
  name: string;
  role: "owner" | "tenant";
}

/** Hatırlatma ayarlarındaki alıcı tercihleri — artış bildirimlerini de kapsar. */
export interface IncreaseNotifyPrefs {
  notifyTenant?: boolean;
  notifyOwner?: boolean;
}

/**
 * Artış bildirimi alıcıları: e-postası olan ve tercihlerde açık olan malik ve
 * kiracı. Tercih belirtilmezse (varsayılan) ikisi de açıktır. E-postası eksik
 * olan taraf atlanır; isim yoksa rol tabanlı varsayılan kullanılır.
 */
export const increaseNotificationRecipients = (
  owner: IncreaseNotifyPerson | null | undefined,
  tenant: IncreaseNotifyPerson | null | undefined,
  prefs: IncreaseNotifyPrefs = {},
): IncreaseNotifyRecipient[] => {
  const recipients: IncreaseNotifyRecipient[] = [];
  if (prefs.notifyOwner !== false && owner?.email) {
    recipients.push({
      email: owner.email,
      name: owner.name ?? "Malik",
      role: "owner",
    });
  }
  if (prefs.notifyTenant !== false && tenant?.email) {
    recipients.push({
      email: tenant.email,
      name: tenant.name ?? "Kiracı",
      role: "tenant",
    });
  }
  return recipients;
};
