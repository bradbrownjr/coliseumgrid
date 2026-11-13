import { useCallback, useState } from 'react';
import { AccessGate, useGoToJoin } from '../components/AccessGate.tsx';
import { useLive } from '../components/useLive.ts';
import { ClaimStep } from './signup/ClaimStep.tsx';
import { DoneStep } from './signup/DoneStep.tsx';
import { HandleStep } from './signup/HandleStep.tsx';
import { PinStep } from './signup/PinStep.tsx';
import { TakenStep } from './signup/TakenStep.tsx';

type Step =
  | { name: 'handle' }
  | { name: 'taken'; handle: string }
  | { name: 'pin'; handle: string; suggestedPin: string }
  | { name: 'claim'; handle: string }
  | { name: 'done'; handle: string; pin?: string };

/** Only a Sign-up device or a signed-in host gets in; anyone else goes to the join screen. */
export function SignupPage() {
  return (
    <AccessGate role="signup">
      <SignupSteps />
    </AccessGate>
  );
}

/** One task per screen (docs/DESIGN.md, "Sign-up"): handle, then PIN, then done. */
function SignupSteps() {
  // Unpaired by the host, or a sign-in that ended: back to the join screen.
  const goToJoin = useGoToJoin();
  useLive({ onMessage: () => undefined, onEnded: goToJoin });
  const [step, setStep] = useState<Step>({ name: 'handle' });
  const restart = useCallback(() => setStep({ name: 'handle' }), []);
  const taken = useCallback((handle: string) => setStep({ name: 'taken', handle }), []);
  const done = useCallback((handle: string, pin?: string) => setStep({ name: 'done', handle, ...(pin !== undefined && { pin }) }), []);

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
      return <DoneStep handle={step.handle} {...(step.pin !== undefined && { pin: step.pin })} onNext={restart} />;
  }
}
