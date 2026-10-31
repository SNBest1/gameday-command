import { DOT_GROUP_SIZE, type ResponsePlan } from '../../contracts.ts';
import type { RunHandle } from './useRun.ts';

/** How long an alert's banner stays up, in sim seconds. */
const ALERT_BANNER_S = 120;

/** A banner over the map while an alert is going out: what was said, how, and to how many. */
export function AlertBanner({ run, plan, incidentAt }: { run: RunHandle; plan: ResponsePlan; incidentAt: number }) {
  const alerts = run.alerts.current ?? [];
  const last = alerts[alerts.length - 1];
  if (!last || run.t - last.t > ALERT_BANNER_S || run.t < last.t) return null;
  // The plan step that sent it: the latest alert step to fire at or before it.
  const step = plan.actions
    .filter(
      (a): a is Extract<ResponsePlan['actions'][number], { type: 'alert' }> =>
        a.type === 'alert' && incidentAt + a.at <= last.t,
    )
    .sort((a, b) => b.at - a.at)[0];
  const live = run.scene.current?.orders?.findLast(
    (entry) => entry.t === last.t && entry.order.type === 'alert',
  )?.order;
  const alert = live?.type === 'alert' ? live : step;
  const how = alert?.channel === 'phone' ? 'Phone alert' : 'PA announcement';
  return (
    <div className="alert-banner">
      <strong>{how}</strong> reached {(last.dots.length * DOT_GROUP_SIZE).toLocaleString()} fans
      {alert?.message && <span className="muted"> “{alert.message}”</span>}
    </div>
  );
}
