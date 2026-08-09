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

/**
 * Artış bildirimi alıcıları: e-postası olan malik ve kiracı. E-postası eksik
 * olan taraf atlanır; isim yoksa rol tabanlı varsayılan kullanılır.
 */
export const increaseNotificationRecipients = (
  owner: IncreaseNotifyPerson | null | undefined,
  tenant: IncreaseNotifyPerson | null | undefined,
): IncreaseNotifyRecipient[] => {
  const recipients: IncreaseNotifyRecipient[] = [];
  if (owner?.email) {
    recipients.push({
      email: owner.email,
      name: owner.name ?? "Malik",
      role: "owner",
    });
  }
  if (tenant?.email) {
    recipients.push({
      email: tenant.email,
      name: tenant.name ?? "Kiracı",
      role: "tenant",
    });
  }
  return recipients;
};
