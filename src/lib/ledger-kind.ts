/**
 * Kira / depozito sınıflandırması — vekil tahsilat ve devir kayıtları için
 * tek kaynak. Ayrım, açıklamanın NOT alanından önceki bölümüne (ilk " · "
 * ayracına kadar) göre yapılır; böylece kullanıcının devir notuna yazdığı
 * "depozito" sözcüğü bir kira devrini depozito olarak sınıflandıramaz.
 *
 * Kayıt açıklamaları (ledger_ops / ledgers / contracts tarafından yazılır):
 *   - "Vekil tahsilatı — kira"            → kira
 *   - "Vekil tahsilatı — depozito"        → depozito
 *   - "Vekil devri — tahsilat teslimi"    → kira devri
 *   - "Vekil devri — depozito teslimi"    → depozito devri
 *   - "Vekil devri — depozito iadesi"     → depozito devri (iade üzerinden)
 */

export type TransferCategory = "rent" | "deposit";

/** Açıklamanın not bölümünden arındırılmış gövdesi. */
export const entryBase = (description: string): string =>
  description.split(" · ")[0].trim();

/** Gövde "depozito" ibaresi içeriyor mu? */
export const transferIsDeposit = (description: string): boolean =>
  entryBase(description).toLocaleLowerCase("tr").includes("depozito");

/** Kaydın türü: kira mı depozito mu. */
export const transferCategory = (
  description: string,
): TransferCategory => (transferIsDeposit(description) ? "deposit" : "rent");
