import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import { useColorScheme } from '@mui/material/styles';

type Mode = 'light' | 'dark' | 'system';

const CHOICES: ReadonlyArray<{ mode: Mode; label: string; icon: typeof LightModeIcon }> = [
  { mode: 'light', label: 'Light', icon: LightModeIcon },
  { mode: 'dark', label: 'Dark', icon: DarkModeIcon },
  { mode: 'system', label: 'Device', icon: BrightnessAutoIcon },
];

/** Not for the Display route: the TV is always dark and never changes the mode. */
export function ColorModePicker() {
  const { mode, setMode } = useColorScheme();

  return (
    <ToggleButtonGroup
      exclusive
      color="primary"
      size="small"
      aria-label="Screen colors"
      // mode is undefined on the first render; the default is the device setting.
      value={mode ?? 'system'}
      onChange={(_event, next: Mode | null) => {
        // Tapping the selected button gives null; one choice always stays picked.
        if (next) setMode(next);
      }}
    >
      {CHOICES.map(({ mode: value, label, icon: Icon }) => (
        // On a phone only the icon shows, so the name is in the aria-label and the tooltip
        // (docs/DESIGN.md, "Phone width"). A Tooltip is fine inside the group: each button
        // reads the group's value from context.
        <Tooltip key={value} title={label}>
          <ToggleButton value={value} aria-label={label} sx={{ gap: 1, px: { xs: 1.5, sm: 2 } }}>
            <Icon fontSize="small" />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              {label}
            </Box>
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}
