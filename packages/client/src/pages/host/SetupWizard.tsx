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
import { createPlanSaves } from './planSaves.ts';
import { usePlayerPick } from './PlayerPicker.tsx';
import { PLAYERS_LOADING_WORDS, STEP_LABELS, estimatePlayersStart, samePlan, withTemplate } from './wizardWords.ts';
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
  /** False until the host screen has the player list, so step 3 doesn't count nobody. */
  playersLoaded: boolean;
  /** Bumped on each `players` live message, so step 3's count follows sign-ups. */
  playersVersion: number;
  /** Bumped on each `plan` live message: another window saved the plan, so read it again. */
  planVersion: number;
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
 *
 * The server's copy of the plan is the one that counts. Saves go out one after another
 * (`createPlanSaves`), a save from another window is read when this one has no change of its
 * own waiting to be saved, and **Start** waits for the saves and starts from the plan the
 * server answered with.
 */
export function SetupWizard({
  mode,
  event,
  players,
  playersLoaded,
  playersVersion,
  planVersion,
  onCancel,
  onEventSaved,
  onEventCreated,
  onStartedBracket,
  onStartedGroups,
}: SetupWizardProps) {
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
  // The plan the server holds, as it last answered. **Start** sends this one.
  const held = useRef<EventPlan | null>(null);
  // True from a change the host made until a save of it was answered, and while a typed value
  // isn't a plan yet: a plan read from another window must not overwrite it.
  const unsaved = useRef(false);
  // Counts the host's changes, so a save that was answered after a newer change doesn't clear `unsaved`.
  const changes = useRef(0);
  const latest = useRef(plan);
  latest.current = plan;

  const takePlan = useCallback((next: EventPlan) => {
    setPlan(next);
    setPoints(next.points.map(String));
  }, []);

  const load = useCallback(async () => {
    setLoadWords(null);
    const result = await getPlan();
    if (!result.ok) return setLoadWords(failureWords(result));
    const stored = result.data.plan;
    held.current = stored;
    setSaved(stored);
    takePlan(stored ?? planDefaults('fighting'));
    const opened = openedAs.current;
    setStep(opened === 'new-event' ? NAME_STEP : opened === 'new-competition' ? PLAN_STEP : stored ? START_STEP : NAME_STEP);
  }, [takePlan]);

  useEffect(() => {
    void load();
  }, [load]);

  const [saves] = useState(() =>
    createPlanSaves(
      savePlan,
      (answered) => {
        held.current = answered;
        setSaved(answered);
      },
      (failure) => setWords(failureWords(failure)),
    ),
  );

  /** Saves the plan after the saves already on their way; true when the server took it. */
  const store = async (next: EventPlan): Promise<boolean> => {
    const mine = changes.current;
    const took = await saves.save(next);
    if (took && changes.current === mine) unsaved.current = false;
    return took;
  };

  /** A change the host made to the plan, shown at once and saved later. */
  const edit = (next: EventPlan) => {
    changes.current += 1;
    unsaved.current = true;
    takePlan(next);
  };

  // Another window saved the plan, or the step changed: read the plan again, unless this window
  // has a change that isn't saved yet, which the read would overwrite.
  const loaded = saved !== undefined;
  const readAgain = useCallback(async () => {
    if (unsaved.current || saves.pending() > 0) return;
    const result = await getPlan();
    if (!result.ok || unsaved.current || saves.pending() > 0) return;
    held.current = result.data.plan;
    setSaved(result.data.plan);
    if (result.data.plan) takePlan(result.data.plan);
  }, [takePlan]);
  const readKey = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const before = readKey.current;
    readKey.current = `${planVersion}:${step}`;
    // The first time is `load`'s own read.
    if (before !== null) void readAgain();
  }, [planVersion, step, loaded, readAgain]);

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

  // A fix on step 3 applies at once, and is saved after any save still on its way, so two fixes
  // in a row both reach the server and the last one stays.
  const fixOnStart = (next: EventPlan) => {
    edit(next);
    void store(next);
  };

  const typePoints = (typed: string[]) => {
    setPoints(typed);
    changes.current += 1;
    unsaved.current = true;
    const parsed = pointsProblem(typed) === null ? parsePoints(typed) : null;
    if (parsed) setPlan((before) => ({ ...before, points: parsed }));
  };

  const count = pick.chosen.length;
  // The count is known once the player list and the event's sign-ups are both loaded. Until then
  // it would read 0 and show "Pick at least 2 players" over a Start that looks switched off.
  const countKnown = playersLoaded && !pick.loading;
  const problem = !countKnown ? null : plan.format === 'heats' ? groupsProblem(count) : startProblem(plan.format, count);

  const start = () =>
    run(async () => {
      if (problem !== null || !countKnown) return;
      // Every change is saved, in order, before the start. One that wasn't taken (a refused save,
      // or a typed value that is now a plan) is saved now, and the start stops if it still isn't.
      await saves.settled();
      if (!samePlan(latest.current, held.current) && !(await store(latest.current))) return;
      // The competition starts from the plan the server holds, and keeps its own copy of the
      // settings, so changing the plan later never changes it.
      const settled = held.current;
      if (!settled) return;
      const playerIds = pick.chosen.map((player) => player.id);
      if (settled.format === 'heats') {
        const result = await startHeats({ stations: settled.stations, races: settled.races, rounds: settled.rounds, points: settled.points, playerIds });
        if (!result.ok) return setWords(failureWords(result));
        return onStartedGroups(result.data.heats);
      }
      const result = await startBracket({ format: settled.format, bestOf: settled.bestOf, stations: settled.stations, playerIds });
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
          onGame={(value) => {
            setGame(value);
            setWords(null);
          }}
          onDice={() => setName(eventName(plan.template, freshRandom()))}
          onTemplate={(template) => edit(withTemplate(plan, template, saved))}
        />
      );
    }
    if (step === PLAN_STEP) {
      return <PlanStep plan={plan} points={points} players={estimateCount} onPlayers={setEstimatePlayers} onPlan={edit} onPoints={typePoints} />;
    }
    return (
      <StartStep
        plan={plan}
        players={players}
        pick={pick}
        countKnown={countKnown}
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
        {step === START_STEP && !countKnown && saved !== undefined && (
          <Typography role="status" color="text.secondary">
            {PLAYERS_LOADING_WORDS}
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
                disabled={busy || !countKnown || problem !== null}
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
