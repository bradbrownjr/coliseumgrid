import type { EventPlan, Player, PlanTemplate } from '@coliseumgrid/core';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GroupIcon from '@mui/icons-material/Group';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { useNow } from '../../components/useNow.ts';
import { ChoiceCards } from './ChoiceCards.tsx';
import { EstimatePanel } from './EstimatePanel.tsx';
import { EventFields } from './EventFields.tsx';
import { PlanOptions } from './PlanOptions.tsx';
import { PlayerPicker, type PlayerPick } from './PlayerPicker.tsx';
import { CARD_CHOICES, NEW_EVENT_WORDS, TEMPLATE_CHOICES, cardOf, planSummary, signedUpWords, withCard, type Card } from './wizardWords.ts';

/** "More options": what a host may leave alone (docs/DESIGN.md, "Setup wizard"). */
function MoreOptions({ children }: { children: ReactNode }) {
  return (
    <Accordion variant="outlined" disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={(theme) => ({ minHeight: theme.spacing(7) })}>
        <Typography sx={{ fontWeight: 'bold' }}>More options</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack sx={{ gap: 3 }}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

interface NameStepProps {
  newEvent: boolean;
  name: string;
  game: string;
  words: string | null;
  template: PlanTemplate;
  onName: (name: string) => void;
  onGame: (game: string) => void;
  onDice: () => void;
  onTemplate: (template: PlanTemplate) => void;
}

/** Step 1, "Name and game": the only typing a host has to do is the name. */
export function NameStep({ newEvent, name, game, words, template, onName, onGame, onDice, onTemplate }: NameStepProps) {
  return (
    <Stack sx={{ gap: 3 }}>
      {newEvent && <Typography sx={{ fontWeight: 'bold' }}>{NEW_EVENT_WORDS}</Typography>}
      <EventFields name={name} game={game} words={words} onName={onName} onGame={onGame} onDice={onDice} />
      <ChoiceCards legend="What kind of game?" value={template} choices={TEMPLATE_CHOICES} onChange={onTemplate} />
    </Stack>
  );
}

interface PlanStepProps {
  plan: EventPlan;
  points: string[];
  /** The players count of the estimate; only for the estimate, never stored. */
  players: number;
  onPlayers: (players: number) => void;
  onPlan: (plan: EventPlan) => void;
  onPoints: (points: string[]) => void;
}

/** Step 2, "How to play": the three cards, the estimate, and "More options" for the picked card. */
export function PlanStep({ plan, points, players, onPlayers, onPlan, onPoints }: PlanStepProps) {
  return (
    <Stack sx={{ gap: 3 }}>
      <ChoiceCards<Card> legend="How do you want to play?" value={cardOf(plan.format)} choices={CARD_CHOICES} onChange={(card) => onPlan(withCard(plan, card))} />
      <EstimatePanel plan={plan} players={players} onPlayers={onPlayers} onFix={onPlan} />
      <MoreOptions>
        <PlanOptions plan={plan} points={points} players={players} onPlan={onPlan} onPoints={onPoints} />
      </MoreOptions>
    </Stack>
  );
}

interface StartStepProps {
  plan: EventPlan;
  players: Player[];
  pick: PlayerPick;
  /** False until the players and the event's sign-ups are loaded: the count, summary, and estimate would show 0 players. */
  countKnown: boolean;
  /** Why the pick can't start, or null; shown above Start. */
  problem: string | null;
  /** A line under the picker's count, such as the group sizes. */
  note: string | null;
  onPlan: (plan: EventPlan) => void;
}

/** Step 3, "Start": the live count, the summary, the estimate with the finish time, and the players. */
export function StartStep({ plan, players, pick, countKnown, problem, note, onPlan }: StartStepProps) {
  const [changing, setChanging] = useState(false);
  // The finish time moves with the clock while the laptop waits for sign-ups.
  const now = useNow(true);
  const count = pick.chosen.length;
  return (
    <Stack sx={{ gap: 3 }}>
      {countKnown && (
        <>
          <Stack sx={{ gap: 0.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <GroupIcon aria-hidden />
              <Typography variant="h5" component="p" aria-live="polite">
                {signedUpWords(pick.inEvent.length)}
              </Typography>
            </Stack>
            <Typography color="text.secondary">{planSummary(plan, count)}</Typography>
          </Stack>
          <EstimatePanel plan={plan} players={count} now={now} onFix={onPlan} />
        </>
      )}
      <MoreOptions>
        {changing ? (
          <PlayerPicker players={players} pick={pick} problem={problem} note={note} />
        ) : (
          <Button variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={() => setChanging(true)}>
            Change players
          </Button>
        )}
      </MoreOptions>
    </Stack>
  );
}
