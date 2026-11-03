// WhatsApp sabah özeti saat seçicisi: "HH:mm" değerini 15 dakikalık adımlarla kaydırır.
// Saf modül (çalışma zamanı importu yok) — node --test ile test edilir.

const STEP = 15;
const DAY = 24 * 60;
const DEFAULT_MINUTES = 8 * 60;

function parseMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function shiftDigestTime(value: string, delta: number): string {
  const current = parseMinutes(value) ?? DEFAULT_MINUTES;
  let next: number;
  if (current % STEP === 0) next = current + delta;
  // 15'in katı değilse yöne göre en yakın 15'e oturt.
  else next = delta > 0 ? Math.ceil(current / STEP) * STEP : Math.floor(current / STEP) * STEP;
  next = ((next % DAY) + DAY) % DAY;
  const hours = String(Math.floor(next / 60)).padStart(2, "0");
  const minutes = String(next % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}
