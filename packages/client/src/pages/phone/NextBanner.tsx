import CloseIcon from '@mui/icons-material/Close';
import NotificationsIcon from '@mui/icons-material/NotificationsActive';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { NextAlert } from './alerts.ts';
import { nextWords } from './phoneWords.ts';

interface NextBannerProps {
  alerts: readonly NextAlert[];
  onDismiss: (playerId: number) => void;
}

/** "Zap, you're next!" in blue, stuck to the top of the page while the player scrolls. No sound (docs/PLAN.md, "Player view"). */
export function NextBanner({ alerts, onDismiss }: NextBannerProps) {
  if (alerts.length === 0) return null;
  return (
    <Box sx={{ position: 'sticky', top: 0, zIndex: 'appBar', display: 'flex', flexDirection: 'column', gap: 1 }}>
      {alerts.map((alert) => (
        <Box
          key={alert.playerId}
          role="alert"
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: 2, pr: 0.5, py: 0.5, borderRadius: 1, bgcolor: 'upNext.main', color: 'upNext.contrastText', boxShadow: 3 }}
        >
          <NotificationsIcon aria-hidden sx={{ flexShrink: 0 }} />
          <Typography variant="h6" component="p" sx={{ flex: 1, minWidth: 0, fontWeight: 700, overflowWrap: 'anywhere' }}>
            {nextWords(alert.handle)} Get ready.
          </Typography>
          <IconButton aria-label={`Hide the message for ${alert.handle}`} onClick={() => onDismiss(alert.playerId)} sx={{ color: 'inherit' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
