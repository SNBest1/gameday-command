import type { HotspotLevel } from './congestion.ts';

/**
 * Warns before a crowd turns critical, not after. Each sim minute the app hands
 * in what it already shows for a plan: every gate's queue and capacity, and the
 * ranked packed areas. A straight line through the last few minutes says how
 * soon a growing crowd crosses the line the congestion ranking calls critical
 * (3,000 packed at danger density) or a gate's queue passes a quarter hour of
 * waiting. Plain arithmetic on the app's own numbers, so it can only be as
 * right as they are; it says what is coming, never what police should do.
 */

/** Packed people at which an area counts as critical, as in `policeHotspots`. */
export const CRITICAL_PACKED = 3000;
/** A gate queue this many minutes long at its current capacity is critical. */
export const CRITICAL_QUEUE_MIN = 15;
/** Warn when the line says critical within this many minutes. */
export const LOOKAHEAD_MIN = 5;
/** Minutes of samples the trend is fitted over. */
const WINDOW_MIN = 3;
/** Back under this share of the limit, the same place may warn again. */
const RESET_SHARE = 0.7;

export interface WarningSample {
  /** Sim seconds. */
  t: number;
  gates: { name: string; open: boolean; waiting: number; capacityPerMin: number }[];
  areas: { where: string; level: HotspotLevel; crowdedPeople: number; stoppedVehicles?: number }[];
}

export interface EarlyWarning {
  key: string;
  stage: 'soon' | 'now';
  t: number;
  /** One sentence, written to be read aloud. */
  text: string;
  /** Whole minutes until critical; 0 when it already is. */
  minutes: number;
}

const n = (x: number) => Math.round(x).toLocaleString('en-US');

/** "300 m from Gate 2" and "320 m from Gate 2" are the same crowd moving a little. */
export const areaKey = (where: string) => where.replace(/^[\d,]+ m from /, '');

/** People per minute, by least squares over the samples. */
function slope(points: { t: number; v: number }[]): number {
  if (points.length < 2) return 0;
  const mt = points.reduce((s, p) => s + p.t, 0) / points.length;
  const mv = points.reduce((s, p) => s + p.v, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - mt) * (p.v - mv);
    den += (p.t - mt) ** 2;
  }
  return den === 0 ? 0 : (num / den) * 60;
}

export class EarlyWarnings {
  private series = new Map<string, { t: number; v: number }[]>();
  private warned = new Map<string, 'soon' | 'now'>();
  private lastT = -Infinity;

  /** Forget everything, for a rewind or a new run. */
  reset() {
    this.series.clear();
    this.warned.clear();
    this.lastT = -Infinity;
  }

  /** New warnings raised by this sample, worst first. A repeated moment is ignored; an earlier one is a rewind and starts over. */
  observe(sample: WarningSample): EarlyWarning[] {
    if (sample.t === this.lastT) return [];
    if (sample.t < this.lastT) this.reset();
    this.lastT = sample.t;
    const out: EarlyWarning[] = [];
    const seen = new Set<string>();

    const track = (key: string, v: number) => {
      seen.add(key);
      const s = this.series.get(key) ?? [];
      s.push({ t: sample.t, v });
      while (s.length && s[0]!.t < sample.t - WINDOW_MIN * 60) s.shift();
      this.series.set(key, s);
      return s;
    };
    const raise = (
      key: string,
      value: number,
      limit: number,
      now: boolean,
      perMin: number,
      say: (minutes: number) => string,
    ) => {
      const had = this.warned.get(key);
      // Already critical the first time it is seen: that is the situation, not news.
      if (now && this.series.get(key)!.length === 1) {
        this.warned.set(key, 'now');
        return;
      }
      // Two readings make a line through any jitter; three make a trend.
      const heading = this.series.get(key)!.length >= 3 && perMin > 0 && (limit - value) / perMin <= LOOKAHEAD_MIN;
      if (value < limit * RESET_SHARE && !now && !heading) {
        this.warned.delete(key);
        return;
      }
      if (now) {
        if (had !== 'now') out.push({ key, stage: 'now', t: sample.t, minutes: 0, text: say(0) });
        this.warned.set(key, 'now');
        return;
      }
      if (had || !heading) return;
      const minutes = (limit - value) / perMin;
      const whole = Math.max(1, Math.round(minutes));
      out.push({ key, stage: 'soon', t: sample.t, minutes: whole, text: say(whole) });
      this.warned.set(key, 'soon');
    };

    for (const a of sample.areas) {
      const key = `area:${areaKey(a.where)}`;
      if (seen.has(key)) continue;
      const s = track(key, a.crowdedPeople);
      const perMin = slope(s);
      raise(key, a.crowdedPeople, CRITICAL_PACKED, a.level === 'critical', perMin, (m) =>
        m === 0
          ? `Critical now ${a.where}: ${n(a.crowdedPeople)} packed${a.stoppedVehicles ? `, ${n(a.stoppedVehicles)} vehicles stopped` : ''}.`
          : `${a.where} heading for critical in about ${m} min: ${n(a.crowdedPeople)} packed, ${n(perMin)} more a minute.`,
      );
    }
    for (const g of sample.gates) {
      if (!g.open || g.capacityPerMin <= 0) continue;
      const key = `gate:${g.name}`;
      const queueMin = g.waiting / g.capacityPerMin;
      const s = track(key, queueMin);
      const perMin = slope(s);
      raise(key, queueMin, CRITICAL_QUEUE_MIN, queueMin >= CRITICAL_QUEUE_MIN, perMin, (m) =>
        m === 0
          ? `${g.name} queue is now ${Math.round(queueMin)} minutes long: ${n(g.waiting)} waiting.`
          : `${g.name} queue passes ${CRITICAL_QUEUE_MIN} minutes in about ${m} min: ${n(g.waiting)} waiting and growing.`,
      );
    }
    // A place that dropped off the ranking has thinned out: start its line again.
    for (const key of [...this.series.keys()]) {
      if (!seen.has(key)) {
        this.series.delete(key);
        if (this.warned.get(key) !== undefined) this.warned.delete(key);
      }
    }
    return out.sort((a, b) => a.minutes - b.minutes);
  }
}
