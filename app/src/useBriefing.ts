import { useEffect } from 'react';
import type { Briefing, Incident, Scorecard } from '../../contracts.ts';
import { getBriefing } from './api.ts';
import type { PlanState } from './PlanCards.tsx';
import { applyDisabled } from './PlanEditor.tsx';

export function useBriefing({
  allDone,
  incident,
  cards,
  planStates,
  briefing,
  briefingBusy,
  setBriefing,
  setBriefingBusy,
}: {
  allDone: boolean;
  incident: Incident | undefined;
  cards: (Scorecard | null)[];
  planStates: PlanState[];
  briefing: Briefing | null;
  briefingBusy: boolean;
  setBriefing: (briefing: Briefing | null) => void;
  setBriefingBusy: (busy: boolean) => void;
}): void {
  // The briefing is only worth asking for once every plan has a scorecard.
  useEffect(() => {
    if (!allDone || !incident || briefing || briefingBusy) return;
    const scorecards = cards.filter((c): c is Scorecard => c !== null);
    setBriefingBusy(true);
    void getBriefing({ incident, plans: planStates.map((p) => applyDisabled(p.plan, p.disabled)), scorecards })
      .then(setBriefing)
      .catch(() => setBriefing(null))
      .finally(() => setBriefingBusy(false));
  }, [allDone, incident, briefing, briefingBusy, cards, planStates]);
}
