import type { Heat, Heats, Player } from '@coliseumgrid/core';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { recordHeat, startHeatTieBreak, undoHeat } from '../../api/heats.ts';
import { useNow } from '../../components/useNow.ts';
import { heatCutAfter, heatTieMessage } from '../../heatsWords.ts';
import { TieNotices } from './BracketLists.tsx';
import { doneHeats, groupsSummary, heatTitle, orderWords, phaseWords, savedWords, showStandings, showsPoints } from './groupWords.ts';
import { GroupResults, GroupStandings, UpNextGroups } from './GroupLists.tsx';
import { GroupStations } from './GroupStations.tsx';
import { RecordDialog } from './RecordDialog.tsx';
import { useWriter, type Say } from './useWriter.ts';

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
  const { busy, run } = useWriter(apply, reload, say);
  const [recording, setRecording] = useState<Heat | null>(null);
  const now = useNow(heats.stations.some((station) => station.heat !== null));

  const undo = (resultId: number, message: string) =>
    run(
      () => undoHeat(resultId),
      (data) => data.heats,
      () => say(message),
    );

  const save = (heat: Heat, order: Player[]) => {
    setRecording(null);
    void run(
      () => recordHeat(heat.id, order.map((player) => player.id)),
      (data) => data.heats,
      (data) => say(savedWords(heat, heats.heats), () => void undo(data.resultId, 'Result undone')),
    );
  };

  const undoHeatResult = (heat: Heat) => {
    if (heat.resultId !== null) void undo(heat.resultId, `Undid: ${heatTitle(heat, heats.heats)}${heat.order ? `, ${orderWords(heat.order)}` : ''}`);
  };

  const playTieBreak = () =>
    run(
      () => startHeatTieBreak(),
      (data) => data.heats,
      () => say('Tie-break races are on the stations'),
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
          <GroupStations stations={heats.stations} heats={heats.heats} now={now} busy={busy} onRecord={setRecording} />
          <UpNextGroups heats={heats.upNext} all={heats.heats} />
        </>
      )}
      {showStandings(heats) && (
        <GroupStandings rows={heats.standings} finished={heats.finished} finalSize={heats.finalSize} cutAfter={heatCutAfter(heats)} points={showsPoints(heats)} />
      )}
      <GroupResults done={doneHeats(heats)} all={heats.heats} busy={busy} onUndo={undoHeatResult} />
      {recording && (
        <RecordDialog heat={recording} races={heats.races} heats={heats.heats} onSave={save} onClose={() => setRecording(null)} />
      )}
    </Stack>
  );
}
