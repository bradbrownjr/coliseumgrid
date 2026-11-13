import type { Player } from '@coliseumgrid/core';
import EditIcon from '@mui/icons-material/Edit';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import MergeIcon from '@mui/icons-material/MergeType';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import KeyIcon from '@mui/icons-material/VpnKey';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useState } from 'react';

interface PlayerActionsProps {
  player: Player;
  canMerge: boolean;
  onRename: () => void;
  onResetPin: () => void;
  onMerge: () => void;
  /** Given only while the bracket or the groups can take a late player and this player isn't in. */
  addLate?: { label: string; run: () => void } | undefined;
  /** A late add is on its way, so the button waits for it. */
  addBusy?: boolean;
}

/**
 * The things a host does to a player: three always, and "Add to bracket" or "Add to group" while a
 * late player can join. They are buttons from the sm breakpoint up and one menu button below it, where the
 * buttons don't fit a row (docs/DESIGN.md, "Phone width"). One list of actions feeds both, so
 * they can't drift apart.
 */
export function PlayerActions({ player, canMerge, onRename, onResetPin, onMerge, addLate, addBusy = false }: PlayerActionsProps) {
  const theme = useTheme();
  const roomForButtons = useMediaQuery(theme.breakpoints.up('sm'));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const actions = [
    { label: 'Rename', icon: <EditIcon />, run: onRename, disabled: false },
    { label: 'Reset PIN', icon: <KeyIcon />, run: onResetPin, disabled: false },
    { label: 'Merge', icon: <MergeIcon />, run: onMerge, disabled: !canMerge },
    ...(addLate ? [{ label: addLate.label, icon: <PersonAddIcon />, run: addLate.run, disabled: addBusy }] : []),
  ];

  if (roomForButtons) {
    return (
      <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {actions.map(({ label, icon, run, disabled }) => (
          <Button key={label} variant="outlined" startIcon={icon} disabled={disabled} onClick={run}>
            {label}
          </Button>
        ))}
      </Stack>
    );
  }

  return (
    <>
      <IconButton aria-label={`Actions for ${player.handle}`} aria-haspopup="menu" onClick={(event) => setAnchor(event.currentTarget)}>
        <MoreVertIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {actions.map(({ label, icon, run, disabled }) => (
          <MenuItem
            key={label}
            disabled={disabled}
            onClick={() => {
              setAnchor(null);
              run();
            }}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText>{label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
