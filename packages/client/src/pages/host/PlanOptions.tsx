import {
  CHANGEOVER_CHOICES,
  HOURS_MAX,
  HOURS_MIN,
  MINUTES_PER_GAME_CHOICES,
  NO_SHOW_CHOICES,
  type EventPlan,
} from '@coliseumgrid/core';
import { BracketOptions } from './BracketOptions.tsx';
import { GroupOptions } from './GroupOptions.tsx';
import { NumberSelect, StationsSelect } from './NumberSelect.tsx';
import { hoursWords, minutesLabel, minutesWords } from './wizardWords.ts';

const HOURS = Array.from({ length: HOURS_MAX - HOURS_MIN + 1 }, (_, i) => HOURS_MIN + i);

interface PlanOptionsProps {
  plan: EventPlan;
  /** What the host typed for the points, 1st to 4th; text, so a half-typed number stays as typed. */
  points: string[];
  /** The players count of the estimate, for the rounds line of groups. */
  players: number;
  onPlan: (plan: EventPlan) => void;
  onPoints: (points: string[]) => void;
}

/**
 * "More options" for the selected card (docs/PLAN.md, "The setup wizard", the table in step 2).
 * Every choice is a select or toggle buttons. Options the engines don't support stay out.
 */
export function PlanOptions({ plan, points, players, onPlan, onPoints }: PlanOptionsProps) {
  const set = <K extends keyof EventPlan>(key: K) => (value: EventPlan[K]) => onPlan({ ...plan, [key]: value });
  return (
    <>
      {plan.format === 'heats' ? (
        <GroupOptions races={plan.races} rounds={plan.rounds} points={points} playerCount={players} onRaces={set('races')} onRounds={set('rounds')} onPoints={onPoints} />
      ) : (
        <BracketOptions lives={plan.format === 'round_robin' ? null : plan.format} bestOf={plan.bestOf} onLives={set('format')} onBestOf={set('bestOf')} />
      )}
      <StationsSelect value={plan.stations} onChange={set('stations')} />
      <NumberSelect label={minutesLabel(plan.template)} value={plan.minutesPerGame} choices={MINUTES_PER_GAME_CHOICES} words={minutesWords} onChange={set('minutesPerGame')} />
      <NumberSelect
        label="Changeover minutes"
        value={plan.changeoverMinutes}
        choices={CHANGEOVER_CHOICES}
        words={minutesWords}
        helperText="Time to swap players."
        onChange={set('changeoverMinutes')}
      />
      <NumberSelect label="Time you have" value={plan.hours} choices={HOURS} words={hoursWords} onChange={set('hours')} />
      <NumberSelect
        label="Wait for a missing player"
        value={plan.noShowMinutes}
        choices={NO_SHOW_CHOICES}
        words={minutesWords}
        helperText="After this, the station shows Forfeit."
        onChange={set('noShowMinutes')}
      />
    </>
  );
}
