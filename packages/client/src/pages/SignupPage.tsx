import type { EventInfo, FollowCode } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { getEvent } from '../api/host.ts';
import { AccessGate, useGoToJoin } from '../components/AccessGate.tsx';
import { EntryHeader } from '../components/EntryFrame.tsx';
import { useLive } from '../components/useLive.ts';
import { ClaimStep } from './signup/ClaimStep.tsx';
import { DoneStep } from './signup/DoneStep.tsx';
import { HandleStep } from './signup/HandleStep.tsx';
import { PinStep } from './signup/PinStep.tsx';
import { TakenStep } from './signup/TakenStep.tsx';
import { followUrl } from '../pairing.ts';

type Step =
  | { name: 'handle' }
  | { name: 'taken'; handle: string }
  | { name: 'pin'; handle: string; suggestedPin: string }
  | { name: 'claim'; handle: string }
  | { name: 'done'; handle: string; pin?: string; followCode: FollowCode };

/** Only a Sign-up device or a signed-in host gets in; anyone else goes to the join screen. */
export function SignupPage() {
  return (
    <AccessGate role="signup">
      <SignupEvent />
    </AccessGate>
  );
}

/** The live event over every step. Unpaired by the host, or a sign-in that ended: back to the join screen. */
function SignupEvent() {
  const goToJoin = useGoToJoin();
  // The event the player is signing up for: the host can rename it or make a new one.
  const [event, setEvent] = useState<EventInfo | null>(null);
  const loadEvent = useCallback(async () => {
    const result = await getEvent();
    if (result.ok) setEvent(result.data.event);
  }, []);
  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);
  useLive({
    onMessage: (message) => {
      if (message.type === 'event') setEvent(message.event);
    },
    onOpen: () => void loadEvent(),
    onEnded: goToJoin,
  });
  return (
    <EntryHeader value={<EventHeader event={event} />}>
      <SignupSteps />
    </EntryHeader>
  );
}

/** One task per screen (docs/DESIGN.md, "Sign-up"): handle, then PIN, then done. */
function SignupSteps() {
  const [step, setStep] = useState<Step>({ name: 'handle' });
  const restart = useCallback(() => setStep({ name: 'handle' }), []);
  const taken = useCallback((handle: string) => setStep({ name: 'taken', handle }), []);
  const done = useCallback(
    (handle: string, followCode: FollowCode, pin?: string) =>
      setStep({ name: 'done', handle, followCode, ...(pin !== undefined && { pin }) }),
    [],
  );

  switch (step.name) {
    case 'handle':
      return (
        <HandleStep
          onAvailable={(handle, suggestedPin) => setStep({ name: 'pin', handle, suggestedPin })}
          onTaken={taken}
        />
      );
    case 'taken':
      return (
        <TakenStep
          handle={step.handle}
          onItsMe={() => setStep({ name: 'claim', handle: step.handle })}
          onPickAnother={restart}
        />
      );
    case 'pin':
      return (
        <PinStep
          handle={step.handle}
          suggestedPin={step.suggestedPin}
          onDone={done}
          onTaken={taken}
          onPickAnother={restart}
        />
      );
    case 'claim':
      return <ClaimStep handle={step.handle} onDone={done} onPickAnother={restart} />;
    case 'done':
      return (
        <DoneStep
          handle={step.handle}
          {...(step.pin !== undefined && { pin: step.pin })}
          followUrl={followUrl(window.location, step.followCode.code)}
          onNext={restart}
        />
      );
  }
}

/**
 * The event name at the top of every sign-up screen, with the game under it when the host typed
 * one, so a player knows what they are signing up for (docs/DESIGN.md, "Sign-up"). Nothing shows
 * before the host names the event.
 */
function EventHeader({ event }: { event: EventInfo | null }) {
  if (!event) return null;
  return (
    <Box component="header" sx={{ width: '100%' }}>
      <Typography variant="h6" component="p" sx={{ fontWeight: 700, overflowWrap: 'anywhere', lineHeight: 1.2 }}>
        {event.name}
      </Typography>
      {event.game && (
        <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {event.game}
        </Typography>
      )}
    </Box>
  );
}
