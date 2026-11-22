const UNIT_MS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

type Unit = keyof typeof UNIT_MS;

const PERMANENT_WORDS = new Set(['perm', 'permanent', 'forever']);

export function parseDuration(input: unknown): number | null {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw || PERMANENT_WORDS.has(raw)) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * UNIT_MS.m;

  const expression = /(\d+)\s*(w|d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(raw)) !== null) {
    matched = true;
    total += Number(match[1]) * UNIT_MS[match[2] as Unit];
  }

  if (!matched || total <= 0) {
    throw new Error(`Invalid duration "${input}". Valid examples: 30s, 5m, 2h, 3d, 1d12h, perm.`);
  }
  return total;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return 'Permanent';
  const units: ReadonlyArray<readonly [Unit, string, number]> = [
    ['w', 'week', UNIT_MS.w],
    ['d', 'day', UNIT_MS.d],
    ['h', 'hour', UNIT_MS.h],
    ['m', 'minute', UNIT_MS.m],
    ['s', 'second', UNIT_MS.s],
  ];
  const parts: string[] = [];
  let rest = ms;

  for (const [, label, size] of units) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      parts.push(`${value} ${label}${value > 1 ? 's' : ''}`);
      rest -= value * size;
    }
  }
  return parts.join(' ') || '0 seconds';
}

export function formatDurationCompact(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const units: ReadonlyArray<readonly [Unit, number]> = [
    ['w', UNIT_MS.w],
    ['d', UNIT_MS.d],
    ['h', UNIT_MS.h],
    ['m', UNIT_MS.m],
    ['s', UNIT_MS.s],
  ];
  const parts: string[] = [];
  let rest = ms;

  for (const [label, size] of units) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      parts.push(`${value}${label}`);
      rest -= value * size;
    }
  }
  return parts.join('') || '0s';
}
