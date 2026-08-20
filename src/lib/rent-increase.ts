/**
 * Kira artışı kuralları — yıllık (12 ay) artış dönemi takibi, artış oranı →
 * yeni kira hesaplama ve "artış dönemi gelen" tespitinin saf (pure)
 * uygulaması. Convex mutation'ı (contracts.applyRentIncrease) ve panel
 * karosu/detay görünümü bu kuralları kullanır; tek kaynak olduğu için birim
 * test edilir.
 */
import { periodKey } from "./ledger-posts";

/** Artış dönemi — Türkiye'de konut kiralamalarında yıllık artış esası. */
export const INCREASE_INTERVAL_MONTHS = 12;

/** Karoda "artış dönemi gelen" sayılan pencere (gün). */
export const INCREASE_LOOKAHEAD_DAYS = 90;

const DAY_MS = 86_400_000;

/** Ay eklerken gün taşmasını önler (örn. 31 Ocak + 1 ay → 28 Şubat). */
const addMonthsStrict = (ts: number, months: number): number => {
  const d = new Date(ts);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, day));
  // Ay taşıması olduysa (ör. 31 → 28 Şubat) ayın son gününe düş
  if (target.getUTCDate() !== day) {
    target.setUTCDate(0);
  }
  return target.getTime();
};

/** Kontrat bitiş tarihi — başlangıç yıldönümünden 1 gün önce (Türk hukuku). */
export const contractEndMs = (
  startDate: number,
  durationMonths: number,
): number => {
  const d = new Date(startDate);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + durationMonths, day));
  if (target.getUTCDate() !== day) {
    target.setUTCDate(0);
  }
  target.setUTCDate(target.getUTCDate() - 1);
  return target.getTime();
};

/**
 * İlk artış tarihi — başlangıçtan 12 ay sonra; kontrat bitişini geçmiyorsa
 * döner. Süre 12 aydan kısaysa kontrat içinde yıllık artış yoktur → null.
 */
export const firstIncreaseDateOf = (
  startDate: number,
  durationMonths: number,
): number | null => {
  if (durationMonths < INCREASE_INTERVAL_MONTHS) return null;
  const first = addMonthsStrict(startDate, INCREASE_INTERVAL_MONTHS);
  return first <= contractEndMs(startDate, durationMonths) ? first : null;
};

/**
 * Bir sonraki artış tarihi. Stored bir tarih varsa 12 ay ileri alır
 * (kontrat bitişini aşarsa null); yoksa ilk yıldönümünü hesaplar.
 */
export const nextIncreaseDateOf = (
  startDate: number,
  durationMonths: number,
  current: number | null | undefined,
): number | null => {
  if (current && current > 0) {
    const advanced = addMonthsStrict(current, INCREASE_INTERVAL_MONTHS);
    return advanced <= contractEndMs(startDate, durationMonths)
      ? advanced
      : null;
  }
  return firstIncreaseDateOf(startDate, durationMonths);
};

/**
 * "Artış dönemi gelen" — tarih geçmişse ya da önümüzdeki pencerenin içindeyse
 * true. Tarih yoksa false.
 */
export const isIncreaseDue = (
  nextIncreaseDate: number | null | undefined,
  now: number,
  lookaheadDays: number = INCREASE_LOOKAHEAD_DAYS,
): boolean => {
  if (!nextIncreaseDate) return false;
  return nextIncreaseDate <= now + lookaheadDays * DAY_MS;
};

/** Yeni kira = mevcut kira × (1 + oran/100), en yakın tam sayıya yuvarlanır. */
export const increasedRent = (
  currentRent: number,
  ratePercent: number,
): number => Math.round(currentRent * (1 + ratePercent / 100));

/** Artışın etkilediği tahakkukların saf seçimi (mutation'ın döngüsü). */
export interface RentAccrualLike {
  type?: string | null;
  period: string;
  amount: number;
  dueDate: number;
}

/**
 * Kira artışından etkilenen tahakkuklar: depozito hariç, etkili tarihin
 * döneminden (dahil) itibaren ve tutarı yeni kira ile aynı olmayanlar.
 * Mutation bu listeyi günceller; vadesi gelmiş olanların cari kayıtlarını da
 * yeniden işler (dueDate <= now).
 */
export const rentAccrualsToUpdate = <T extends RentAccrualLike>(
  accruals: T[],
  effectiveDate: number,
  newAmount: number,
): T[] => {
  const startPeriod = periodKey(effectiveDate);
  return accruals.filter(
    (a) =>
      (a.type ?? "rent") !== "deposit" &&
      a.period >= startPeriod &&
      a.amount !== newAmount,
  );
};

/**
 * Karo için etkin "sonraki artış tarihi":
 * - kayıtlı nextIncreaseDate varsa o;
 * - artış özelliği hiç kullanılmamışsa (lastIncreaseDate yok) ilk yıldönümü
 *   (mevcut kontratların karoda görünmesi için);
 * - artış uygulanmış ama nextIncreaseDate kaybolmuşsa null.
 */
export const effectiveNextIncreaseDate = (contract: {
  startDate: number;
  durationMonths: number;
  nextIncreaseDate?: number | null;
  lastIncreaseDate?: number | null;
}): number | null => {
  if (contract.nextIncreaseDate) return contract.nextIncreaseDate;
  if (contract.lastIncreaseDate) return null;
  return firstIncreaseDateOf(contract.startDate, contract.durationMonths);
};
