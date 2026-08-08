/**
 * KDV hesabı — kira bedeli KDV dahil/hariç olduğunda aylık KDV tutarını ve
 * KDV dahil toplam kirayı hesaplar. Kontrat formunda (malik şirketse) ve
 * kontrat belgesinde kullanılır; saf fonksiyon olduğu için birim test edilir.
 */

export type RentVatMode = "dahil" | "haric";

export interface VatBreakdown {
  /** Aylık KDV tutarı (₺). */
  vatAmount: number;
  /** KDV dahil toplam aylık kira (₺). */
  vatInclusiveRent: number;
}

/**
 * KDV tutarı — kira bedeli KDV hariçse KDV ayrıca eklenir (kira × oran);
 * KDV dahilse fiyatın içinden çıkarılır (tutar − tutar / (1 + oran/100)).
 */
export const computeVat = (
  rentAmount: number,
  vatRate: number,
  mode: RentVatMode,
): VatBreakdown => {
  const vatAmount =
    mode === "dahil"
      ? rentAmount - rentAmount / (1 + vatRate / 100)
      : rentAmount * (vatRate / 100);
  const vatInclusiveRent =
    mode === "dahil" ? rentAmount : rentAmount + vatAmount;
  return { vatAmount, vatInclusiveRent };
};
