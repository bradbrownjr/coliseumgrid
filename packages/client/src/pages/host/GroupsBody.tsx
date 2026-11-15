import type { Heat, HeatStation, Heats, Player } from '@coliseumgrid/core';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { GROUP_RESULT_WORDS } from '../../api/errors.ts';
import { markHeatArrived, recordHeat, startHeatTieBreak, undoHeat } from '../../api/heats.ts';
import { useNow } from '../../components/useNow.ts';
import { heatCutAfter, heatTieMessage } from '../../heatsWords.ts';
import { arrivedWords, waitingAgainWords } from '../../noShow.ts';
import { TieNotices } from './BracketLists.tsx';
import { doneHeats, groupsSummary, heatOnStation, heatResultWords, heatTitle, phaseWords, savedWords, showStandings, showsPoints } from './groupWords.ts';
import { GroupResults, GroupStandings, UpNextGroups } from './GroupLists.tsx';
import { GroupStations } from './GroupStations.tsx';
import { RecordDialog } from './RecordDialog.tsx';
import { STILL_SAVING, useWriter, type Say } from './useWriter.ts';

interface GroupsBodyProps {
  heats: Heats;
  /** Takes the groups from the answer to a write. */
  apply: (heats: Heats) => void;
  reload: () => Promise<void>;
  say: Say;
}

/**
 * The host's controls for groups: record each group's order, undo a result, play a tie-break,
 * and see the standings with the cut line. The server sends the groups whole each time, and this
 * only shows them (docs/PLAN.md, "Heats API").
 */
export function GroupsBody({ heats, apply, reload, say }: GroupsBodyProps) {
  const { busy, run, isWorking } = useWriter(apply, reload, say);
  // `askMissing` when opened from Forfeit: the panel asks who is missing first.
  const [recording, setRecording] = useState<{ heat: Heat; askMissing: boolean } | null>(null);
  const now = useNow(heats.stations.some((station) => station.heat !== null));

  // The snackbar's Undo works while the dialog is open, and it can take back the round the open
  // group belongs to. The dialog closes with the group, so Save never goes to a group that is gone.
  const gone = recording !== null && !heatOnStation(heats, recording.heat.id);
  useEffect(() => {
    if (!gone) return;
    setRecording(null);
    say("That group isn't on a station anymore.");
  }, [gone, say]);

  const undo = (resultId: number, message: string) =>
    run(
      () => undoHeat(resultId),
      (data) => data.heats,
      () => say(message),
    );

  const save = (heat: Heat, order: Player[], missing: Player[]) => {
    // While another change is on its way, keep the dialog open with the order the host entered.
    if (isWorking()) {
      say(STILL_SAVING);
      return;
    }
    setRecording(null);
    void run(
      () => recordHeat(heat.id, order.map((player) => player.id), missing.map((player) => player.id)),
      (data) => data.heats,
      (data) => say(savedWords(heat, heats.heats), () => void undo(data.resultId, 'Result undone')),
      GROUP_RESULT_WORDS,
    );
  };

  // **They're here** ends the wait for this call of the group, on the host's cards and on the
  // TV. The snackbar's Undo puts the wait back (docs/PLAN.md, "Waiting for a missing player").
  const here = (station: HeatStation) => {
    const heat = station.heat;
    if (!heat) return;
    const waitAgain = () =>
      run(
        () => markHeatArrived(heat.id, false),
        (data) => data.heats,
        () => say(waitingAgainWords(station.number)),
      );
    void run(
      () => markHeatArrived(heat.id),
      (data) => data.heats,
      () => say(arrivedWords(station.number), () => void waitAgain()),
    );
  };

  const undoHeatResult = (heat: Heat) => {
    const result = heatResultWords(heat);
    if (heat.resultId !== null) void undo(heat.resultId, `Undid: ${heatTitle(heat, heats.heats)}${result ? `, ${result}` : ''}`);
  };

  const playTieBreak = () =>
    run(
      () => startHeatTieBreak(),
      (data) => data.heats,
      () => say('Tie-break groups are on the stations'),
    );

  return (
    <Stack sx={{ gap: 3 }}>
      <Stack sx={{ gap: 0.5 }}>
        <Typography variant="h6" component="h3" aria-live="polite">
          {phaseWords(heats)}
        </Typography>
        <Typography color="text.secondary">{groupsSummary(heats)}</Typography>
      </Stack>
      <TieNotices ties={heats.ties} busy={busy} onPlay={() => void playTieBreak()} message={(tie) => heatTieMessage(tie, heats)} />
      {!heats.finished && (
        <>
          <GroupStations
            stations={heats.stations}
            heats={heats.heats}
            now={now}
            busy={busy}
            noShowMinutes={heats.noShowMinutes}
            onRecord={(heat) => setRecording({ heat, askMissing: false })}
            onHere={here}
            onForfeit={(heat) => setRecording({ heat, askMissing: true })}
          />
          <UpNextGroups heats={heats.upNext} all={heats.heats} />
        </>
      )}
      {showStandings(heats) && (
        <GroupStandings rows={heats.standings} finished={heats.finished} finalSize={heats.finalSize} cutAfter={heatCutAfter(heats)} points={showsPoints(heats)} />
      )}
      <GroupResults done={doneHeats(heats)} all={heats.heats} busy={busy} onUndo={undoHeatResult} />
      {recording && !gone && (
        <RecordDialog
          key={`${recording.heat.id}-${recording.askMissing}`}
          heat={recording.heat}
          races={heats.races}
          heats={heats.heats}
          askMissing={recording.askMissing}
          onSave={save}
          onClose={() => setRecording(null)}
        />
      )}
    </Stack>
  );
}
