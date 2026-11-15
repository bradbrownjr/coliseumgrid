import { eventName, planDefaults, type Bracket, type EventInfo, type EventPlan, type Heats, type Player } from '@coliseumgrid/core';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startBracket } from '../../api/bracket.ts';
import { failureWords } from '../../api/errors.ts';
import { startHeats } from '../../api/heats.ts';
import { createEvent, getPlan, saveEvent, savePlan } from '../../api/host.ts';
import { freshRandom } from '../../random.ts';
import { startProblem } from './bracketWords.ts';
import { eventNameFits, useSyncedField } from './EventFields.tsx';
import { groupSizesWords, groupsProblem, parsePoints, pointsProblem } from './groupWords.ts';
import { usePlayerPick } from './PlayerPicker.tsx';
import { STEP_LABELS, estimatePlayersStart, withTemplate } from './wizardWords.ts';
import { NameStep, PlanStep, StartStep } from './WizardSteps.tsx';

/**
 * - `setup`: the event has no bracket and no groups, so the wizard is the host screen's top.
 * - `new-event`: **New event** in play mode; step 1 starts empty and makes a new event.
 * - `new-competition`: **New competition** after a finish; it opens at step 2, since the event
 *   and its game are set.
 */
export type WizardMode = 'setup' | 'new-event' | 'new-competition';

const NAME_STEP = 0;
const PLAN_STEP = 1;
const START_STEP = 2;

interface SetupWizardProps {
  mode: WizardMode;
  event: EventInfo | null;
  players: Player[];
  /** Bumped on each `players` live message, so step 3's count follows sign-ups. */
  playersVersion: number;
  /** Back to play mode; left out in setup mode, where there is nothing to go back to. */
  onCancel?: (() => void) | undefined;
  onEventSaved: (event: EventInfo) => void;
  /** A new event is the current one; it has no bracket and no groups yet. */
  onEventCreated: (event: EventInfo) => void;
  onStartedBracket: (bracket: Bracket) => void;
  onStartedGroups: (heats: Heats) => void;
}

/**
 * The setup wizard (docs/PLAN.md, "The setup wizard"; docs/DESIGN.md, "Setup wizard"): name and
 * game, how to play, start. Steps 1 and 2 come before sign-up and step 3 after it, so every
 * choice is saved on the server as the event's plan, and a reload or a second window finds it.
 * The wizard opens at step 3 when the event already has a plan, since that is where it waits
 * during sign-up.
 */
export function SetupWizard({ mode, event, players, playersVersion, onCancel, onEventSaved, onEventCreated, onStartedBracket, onStartedGroups }: SetupWizardProps) {
  // undefined while loading; null when the event has no plan.
  const [saved, setSaved] = useState<EventPlan | null | undefined>(undefined);
  const [loadWords, setLoadWords] = useState<string | null>(null);
  const [plan, setPlan] = useState<EventPlan>(() => planDefaults('fighting'));
  const [points, setPoints] = useState<string[]>(() => plan.points.map(String));
  const [step, setStep] = useState(NAME_STEP);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Null follows the sign-ups; a number is the host's own pick for the estimate.
  const [estimatePlayers, setEstimatePlayers] = useState<number | null>(null);
  // In new-event mode the fields start empty: the new event has no name until Next.
  const startsEmpty = useRef(mode === 'new-event');
  const [name, setName] = useSyncedField(startsEmpty.current ? '' : (event?.name ?? ''));
  const [game, setGame] = useSyncedField(startsEmpty.current ? '' : (event?.game ?? ''));
  const pick = usePlayerPick(players, () => setWords(null), playersVersion);
  // The mode the wizard opened in picks its first step once, when the plan arrives.
  const openedAs = useRef(mode);

  const takePlan = useCallback((next: EventPlan) => {
    setPlan(next);
    setPoints(next.points.map(String));
  }, []);

  const load = useCallback(async () => {
    setLoadWords(null);
    const result = await getPlan();
    if (!result.ok) return setLoadWords(failureWords(result));
    const stored = result.data.plan;
    setSaved(stored);
    takePlan(stored ?? planDefaults('fighting'));
    const opened = openedAs.current;
    setStep(opened === 'new-event' ? NAME_STEP : opened === 'new-competition' ? PLAN_STEP : stored ? START_STEP : NAME_STEP);
  }, [takePlan]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Saves the plan; true when the server took it. */
  const store = async (next: EventPlan): Promise<boolean> => {
    const result = await savePlan(next);
    if (!result.ok) {
      setWords(failureWords(result));
      return false;
    }
    setSaved(result.data.plan);
    return true;
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setWords(null);
    await work();
    setBusy(false);
  };

  // Step 1's Next: the name and game, then the plan with the template's choices.
  const saveNameStep = () =>
    run(async () => {
      const trimmedName = name.trim();
      const trimmedGame = game.trim();
      if (mode === 'new-event') {
        const result = await createEvent(trimmedName, trimmedGame);
        if (!result.ok) return setWords(failureWords(result));
        onEventCreated(result.data.event);
        // The new event starts with nobody; don't wait for the live message to drop the old event's players.
        void pick.reload();
      } else {
        const result = await saveEvent(trimmedName, trimmedGame);
        if (!result.ok) return setWords(failureWords(result));
        if (result.data.event) onEventSaved(result.data.event);
      }
      if (await store(plan)) setStep(PLAN_STEP);
    });

  const savePlanStep = () =>
    run(async () => {
      if (await store(plan)) setStep(START_STEP);
    });

  // A fix on step 3 applies at once, and is saved like any other change.
  const fixOnStart = (next: EventPlan) => {
    takePlan(next);
    void run(async () => {
      await store(next);
    });
  };

  const typePoints = (typed: string[]) => {
    setPoints(typed);
    const parsed = pointsProblem(typed) === null ? parsePoints(typed) : null;
    if (parsed) setPlan((before) => ({ ...before, points: parsed }));
  };

  const count = pick.chosen.length;
  const problem = plan.format === 'heats' ? groupsProblem(count) : startProblem(plan.format, count);

  const start = () =>
    run(async () => {
      if (problem !== null) return;
      const playerIds = pick.chosen.map((player) => player.id);
      // The competition keeps its own copy of the settings, so changing the plan later never changes it.
      if (plan.format === 'heats') {
        const result = await startHeats({ stations: plan.stations, races: plan.races, rounds: plan.rounds, points: plan.points, playerIds });
        if (!result.ok) return setWords(failureWords(result));
        return onStartedGroups(result.data.heats);
      }
      const result = await startBracket({ format: plan.format, bestOf: plan.bestOf, stations: plan.stations, playerIds });
      if (!result.ok) return setWords(failureWords(result));
      onStartedBracket(result.data.bracket);
    });

  const title = mode === 'new-competition' ? 'New competition' : mode === 'new-event' ? 'New event' : 'Event';
  const signedUp = pick.inEvent.length;
  const estimateCount = estimatePlayers ?? estimatePlayersStart(signedUp);

  const body = () => {
    if (saved === undefined) {
      return loadWords ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {loadWords}
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading the setup" />
        </Box>
      );
    }
    if (step === NAME_STEP) {
      return (
        <NameStep
          newEvent={mode === 'new-event'}
          name={name}
          game={game}
          words={words}
          template={plan.template}
          onName={(value) => {
            setName(value);
            setWords(null);
          }}
          onGame={setGame}
          onDice={() => setName(eventName(plan.template, freshRandom()))}
          onTemplate={(template) => takePlan(withTemplate(plan, template, saved))}
        />
      );
    }
    if (step === PLAN_STEP) {
      return <PlanStep plan={plan} points={points} players={estimateCount} onPlayers={setEstimatePlayers} onPlan={takePlan} onPoints={typePoints} />;
    }
    return (
      <StartStep
        plan={plan}
        players={players}
        pick={pick}
        problem={problem}
        note={plan.format === 'heats' ? groupSizesWords(count) : null}
        onPlan={fixOnStart}
      />
    );
  };

  // Step 1's refusal shows under the name field; the others show above the buttons.
  const footWords = step === NAME_STEP ? null : words;
  const nextDisabled =
    busy || (step === NAME_STEP && !eventNameFits(name)) || (step === PLAN_STEP && plan.format === 'heats' && pointsProblem(points) !== null);
  // New competition opens at step 2: the event and its game are already set.
  const canGoBack = step === START_STEP || (step === PLAN_STEP && mode !== 'new-competition');

  return (
    <Box component="section" aria-labelledby="wizard-title">
      <Typography id="wizard-title" variant="h4" component="h2" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Stepper activeStep={step} alternativeLabel>
          {STEP_LABELS.map((label, index) => (
            <Step key={label} completed={index < step}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {body()}
        {footWords && <Alert severity="error">{footWords}</Alert>}
        {step === START_STEP && problem && saved !== undefined && (
          <Typography role="alert" color="error">
            {problem}
          </Typography>
        )}
        {saved !== undefined && (
          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
            <Stack direction="row" sx={{ gap: 1 }}>
              {onCancel && (
                <Button size="large" onClick={onCancel} disabled={busy}>
                  Cancel
                </Button>
              )}
              {canGoBack && (
                <Button size="large" onClick={() => setStep((before) => before - 1)} disabled={busy}>
                  Back
                </Button>
              )}
            </Stack>
            {step === START_STEP ? (
              <Button
                variant="contained"
                size="large"
                startIcon={<PlayArrowIcon />}
                disabled={busy || pick.loading || problem !== null}
                onClick={() => void start()}
                sx={(theme) => ({ minHeight: theme.spacing(9), minWidth: theme.spacing(24), typography: 'h5', flexGrow: { xs: 1, sm: 0 } })}
              >
                Start
              </Button>
            ) : (
              <Button variant="contained" size="large" disabled={nextDisabled} onClick={() => void (step === NAME_STEP ? saveNameStep() : savePlanStep())}>
                Next
              </Button>
            )}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
