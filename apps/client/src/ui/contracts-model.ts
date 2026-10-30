import type { EventView, CompletedChallengeView, GameMap } from '@heist/shared';
export function completedContracts(event: EventView, map?: GameMap | null): CompletedChallengeView[] {
  if (event.completedChallenges) return event.completedChallenges;
  // Compatible with an older server during frontend rollout, without inventing history.
  return event.challenges.filter(c => c.solved).map(c => {
    const template = c.title.split(' · ')[0], job = event.jobs.find(j => j.id === template);
    const venue = map?.hotspots.find(h => h.id === job?.station);
    const scene = map?.scenes?.find(s => s.id === job?.district);
    return {id:c.id,template,title:c.title,mode:c.reward ? 'job' : 'training',completedAt:0,
      station:job?.station,district:job?.district,location:`${scene?.name ?? job?.district ?? 'Veyra City'} · ${venue?.name ?? 'Challenge station'}`};
  });
}
export const activeContracts = (event: EventView) => event.challenges.filter(c => !c.solved);
export function availableContracts(event: EventView) {
  // Practising a template must not conceal its still-eligible paid contract.
  const paid = new Set(completedContracts(event).filter(c => c.mode === 'job').map(c => c.template));
  return event.jobs.filter(j => !paid.has(j.id));
}
