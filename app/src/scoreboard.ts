import type { Scorecard } from '../../contracts.ts';

/**
 * The plans side by side in one small table: live counts while they run, the
 * results once they finish. Lower is better on every row; the best value is
 * marked only when it is strictly better than another plan's, so a tie marks
 * nothing. Never-cleared counts as worse than any time.
 */

export interface ScoreRow {
  label: string;
  hint: string;
  cells: string[];
  /** Index of the plan with the best value, or null when there is nothing to choose. */
  best: number | null;
}

const n = (x: number) => Math.round(x).toLocaleString('en-US');

function bestOf(values: (number | null)[]): number | null {
  const scored = values.map((v, i) => ({ v: v ?? Infinity, i }));
  const min = Math.min(...scored.map((s) => s.v));
  if (!Number.isFinite(min) && min === Infinity) return null;
  const at = scored.filter((s) => s.v === min);
  if (at.length !== 1 || scored.every((s) => s.v === min)) return null;
  return at[0]!.i;
}

export function liveRows(stats: { zonePeople: number; dangerPeople: number }[]): ScoreRow[] {
  return [
    {
      label: 'In the zone now',
      hint: 'People inside the incident zone',
      cells: stats.map((s) => n(s.zonePeople)),
      best: bestOf(stats.map((s) => s.zonePeople)),
    },
    {
      label: 'Dangerously packed',
      hint: 'People standing tighter than the danger line, anywhere',
      cells: stats.map((s) => n(s.dangerPeople)),
      best: bestOf(stats.map((s) => s.dangerPeople)),
    },
  ];
}

export function resultRows(cards: Scorecard[]): ScoreRow[] {
  const clear = cards.map((c) => c.timeToClearMin);
  return [
    {
      label: 'Time to clear',
      hint: 'Minutes until the zone thinned to safe levels',
      cells: clear.map((m) => (m === null ? 'never' : `${m.toFixed(1)} min`)),
      best: bestOf(clear),
    },
    {
      label: 'Crush-risk minutes',
      hint: 'Cell-minutes over the danger line after the incident',
      cells: cards.map((c) => n(c.dangerMinutes)),
      best: bestOf(cards.map((c) => c.dangerMinutes)),
    },
    {
      label: 'Officer time',
      hint: 'Officers committed, times how long',
      cells: cards.map((c) => `${n(c.officerMinutesUsed)} min`),
      best: bestOf(cards.map((c) => c.officerMinutesUsed)),
    },
  ];
}

/** The comparison as plain text, for a radio log, an email or a report. */
export function summaryText(
  heading: string,
  labels: readonly string[],
  names: string[],
  verdict: string,
  rows: ScoreRow[],
): string {
  const plans = labels.map((l, i) => `  ${l}: ${names[i]}`).join('\n');
  const table = rows.map((r) => `  ${r.label}: ${r.cells.map((c, i) => `${labels[i]} ${c}`).join(', ')}`).join('\n');
  return `${heading}\n\nPlans\n${plans}\n\nResults\n${table}\n\n${verdict}\n\nSimulated crowd and traffic: an assumption, not a forecast. The commander makes the call.\n`;
}
