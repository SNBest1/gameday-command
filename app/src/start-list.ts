/**
 * The stadium list on the start screen: one card per stadium, the ready-made
 * ones first, imports alphabetically, the practice map last. Importing the same
 * stadium twice left two identical cards; the built-in or first copy wins.
 */
export interface StadiumRow {
  id: string;
  name: string;
  imported?: boolean;
}

export const stadiumName = (name: string) => name.replace(/ \+ 0\.5 mi$/, '').trim();

export function orderStadiums<T extends StadiumRow>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of [...rows].sort((a, b) => Number(!!a.imported) - Number(!!b.imported))) {
    const key = stadiumName(r.name).toLowerCase();
    if (!seen.has(key)) seen.set(key, r);
  }
  const rank = (r: T) => (r.id === 'test-3gate' ? 2 : r.imported ? 1 : 0);
  return [...seen.values()].sort((a, b) => rank(a) - rank(b) || stadiumName(a.name).localeCompare(stadiumName(b.name)));
}

/** Where it is, unless that only repeats its name. */
export function whereText(name: string, where: string): string {
  return where && where.toLowerCase() !== stadiumName(name).toLowerCase() ? where : '';
}
