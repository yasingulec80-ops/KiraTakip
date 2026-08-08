/**
 * Tahsilat kaydı kuralları — "Ödeyen vekil ile tahsilatı yapan vekil aynı
 * olamaz" kuralının saf uygulaması. Hem arayüzde (CollectionSection) hem
 * sunucuda (collections.create) kullanılır; tek kaynak olduğu için birim
 * test edilir.
 */

/**
 * Ödeyen vekil (paidByType = "proxy") ile tahsilatı yapan vekil aynı ise
 * çelişkili kayıt oluşur: vekilin cari hesabında hem alacak hem borç aynı
 * tutarda yazılır ve birbirini götürür. Bu kombinasyon engellenir.
 */
export const sameProxyCollectionConflict = (
  paidByType: string | undefined | null,
  payerProxyId: unknown, // form.personId / args.proxyOwnerId (ödeyen vekil)
  collectorProxyId: unknown, // form.collectedByProxyOwnerId / args.collectedByProxyOwnerId
): boolean =>
  paidByType === "proxy" &&
  !!payerProxyId &&
  !!collectorProxyId &&
  String(payerProxyId) === String(collectorProxyId);
