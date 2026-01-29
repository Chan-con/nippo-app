export const DEFAULT_TIME_ZONE = 'Asia/Tokyo';

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string') return false;
  const v = tz.trim();
  if (!v) return false;
  try {
    // Will throw RangeError for invalid timeZone.
    new Intl.DateTimeFormat('en-US', { timeZone: v }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(tz: unknown): string {
  const v = typeof tz === 'string' ? tz.trim() : '';
  return isValidTimeZone(v) ? v : DEFAULT_TIME_ZONE;
}

type ZonedParts = {
  year: number;
  month0: number; // 0-11
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  year2: string;
  month2: string;
  day2: string;
  hour2: string;
  minute2: string;
  second2: string;
  weekday0: number; // 0=Sun..6=Sat
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedPartsFromMs(ms: number, timeZone: string): ZonedParts {
  const tz = normalizeTimeZone(timeZone);
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(d);

  const map = new Map<string, string>();
  for (const p of parts) {
    if (p.type !== 'literal') map.set(p.type, p.value);
  }

  const year2 = map.get('year') || '1970';
  const month2 = map.get('month') || '01';
  const day2 = map.get('day') || '01';
  const hour2 = map.get('hour') || '00';
  const minute2 = map.get('minute') || '00';
  const second2 = map.get('second') || '00';
  const wd = map.get('weekday') || 'Sun';

  const year = parseInt(year2, 10);
  const month = parseInt(month2, 10);
  const day = parseInt(day2, 10);
  const hour = parseInt(hour2, 10);
  const minute = parseInt(minute2, 10);
  const second = parseInt(second2, 10);

  const weekday0 = WEEKDAY_MAP[wd] ?? 0;

  return {
    year,
    month0: month - 1,
    day,
    hour,
    minute,
    second,
    year2,
    month2,
    day2,
    hour2,
    minute2,
    second2,
    weekday0,
  };
}

export function getZonedYmdFromMs(ms: number, timeZone: string): string {
  const p = getZonedPartsFromMs(ms, timeZone);
  return `${p.year2}-${p.month2}-${p.day2}`;
}

export function getZonedHmFromMs(ms: number, timeZone: string): string {
  const p = getZonedPartsFromMs(ms, timeZone);
  return `${p.hour2}:${p.minute2}`;
}

export function formatIsoToZonedYmdHm(iso: string, timeZone: string): string {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const tz = normalizeTimeZone(timeZone);
  try {
    return d
      .toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: tz,
      })
      .replace(/\//g, '/');
  } catch {
    return d.toISOString();
  }
}

export function isoToZonedDatetimeLocalValue(iso: string, timeZone: string): string {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const tz = normalizeTimeZone(timeZone);
  try {
    // sv-SE: YYYY-MM-DD HH:mm:ss
    const s = d.toLocaleString('sv-SE', { timeZone: tz, hour12: false });
    const v = s.replace(' ', 'T');
    return v.slice(0, 16);
  } catch {
    return '';
  }
}

export function getTimeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const tz = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const map = new Map<string, string>();
  for (const p of parts) {
    if (p.type !== 'literal') map.set(p.type, p.value);
  }

  const y = parseInt(map.get('year') || '1970', 10);
  const m = parseInt(map.get('month') || '1', 10);
  const d = parseInt(map.get('day') || '1', 10);
  const hh = parseInt(map.get('hour') || '0', 10);
  const mm = parseInt(map.get('minute') || '0', 10);
  const ss = parseInt(map.get('second') || '0', 10);

  const asUtc = Date.UTC(y, m - 1, d, hh, mm, ss, 0);
  return asUtc - utcMs;
}

export function zonedLocalDateTimeToUtcMs(args: { year: number; month0: number; day: number; hour: number; minute: number; second?: number }, timeZone: string): number {
  const { year, month0, day, hour, minute } = args;
  const second = typeof args.second === 'number' && Number.isFinite(args.second) ? Math.trunc(args.second) : 0;

  // Start from a naive UTC guess and iteratively correct using the time-zone offset.
  const naiveUtc = Date.UTC(year, month0, day, hour, minute, second, 0);
  let utcMs = naiveUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(timeZone, utcMs);
    utcMs = naiveUtc - offset;
  }
  return utcMs;
}

export function zonedDatetimeLocalValueToIso(v: string, timeZone: string): string {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return '';
  const year = parseInt(m[1], 10);
  const month0 = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  if (![year, month0, day, hour, minute].every((x) => Number.isFinite(x))) return '';

  const utcMs = zonedLocalDateTimeToUtcMs({ year, month0, day, hour, minute, second: 0 }, timeZone);
  return new Date(utcMs).toISOString();
}

export function getCommonTimeZones(): string[] {
  // Keep list short for UI; user can still type a custom IANA tz.
  return [
    'Asia/Tokyo',
    'UTC',
    'Asia/Seoul',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Australia/Sydney',
    'Europe/London',
    'Europe/Paris',
    'America/New_York',
    'America/Los_Angeles',
  ].filter(isValidTimeZone);
}
