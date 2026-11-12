import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Logo } from '../components/Logo.tsx';

/**
 * The TV is always dark. The `mode-dark` class matches the theme's colorSchemeSelector, so
 * everything inside gets the dark values whatever the host picked. This page never calls
 * setMode, so it can't change the host's choice on a shared browser.
 */
export function DisplayPage() {
  return (
    <Box
      className="mode-dark"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        bgcolor: 'background.default',
        color: 'text.primary',
        textAlign: 'center',
      }}
    >
      <Logo size={16} />
      <Typography variant="h2" component="h1">
        Display
      </Typography>
      <Typography variant="h5">Who plays next will show here.</Typography>
    </Box>
  );
}
