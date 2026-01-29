function parseYmd(ymd: string): { y: number; m0: number; d: number } | null {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const m0 = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m0) || !Number.isFinite(d)) return null;
  if (m0 < 0 || m0 > 11) return null;
  if (d < 1 || d > 31) return null;
  return { y, m0, d };
}

export function ymdToUtcDayNumber(ymd: string): number | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const ms = Date.UTC(p.y, p.m0, p.d);
  return Math.floor(ms / 86400000);
}

export function utcDayNumberToYmd(day: number): string {
  const d = new Date(day * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const day = ymdToUtcDayNumber(ymd);
  if (day == null) return ymd;
  return utcDayNumberToYmd(day + Math.trunc(deltaDays || 0));
}

export function getJstYmdFromDate(d: Date): string {
  const date = d instanceof Date ? d : new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = new Map<string, string>();
  for (const p of parts) {
    if (p.type !== 'literal') map.set(p.type, p.value);
  }

  const y = map.get('year') || '1970';
  const m = map.get('month') || '01';
  const dd = map.get('day') || '01';
  return `${y}-${m}-${dd}`;
}

export function getTodayYmdJst(): string {
  return getJstYmdFromDate(new Date());
}
