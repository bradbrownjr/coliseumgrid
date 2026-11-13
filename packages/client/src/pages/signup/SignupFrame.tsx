import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Logo } from '../../components/Logo.tsx';

interface SignupFrameProps {
  title: string;
  /** The PIN screens: as wide as the keypad, so the buttons line up with it. */
  narrow?: boolean;
  children: ReactNode;
}

/** Every sign-up screen is one centered panel (docs/DESIGN.md, "Sign-up"). */
export function SignupFrame({ title, narrow = false, children }: SignupFrameProps) {
  return (
    <Container
      component="main"
      maxWidth={narrow ? 'xs' : 'sm'}
      sx={{
        minHeight: '100dvh',
        py: { xs: 2, sm: 4 },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: { xs: 2, sm: 3 },
        textAlign: 'center',
      }}
    >
      {/* The keypad screens need the height. */}
      {!narrow && <Logo size={10} />}
      <Typography variant="h3" component="h1" sx={{ overflowWrap: 'anywhere' }}>
        {title}
      </Typography>
      {children}
    </Container>
  );
}

/** The main button on a sign-up screen: full width and tall. */
export const bigButtonSx: SxProps<Theme> = {
  minHeight: (theme) => theme.spacing(9),
  typography: 'h5',
};

/** A text button under the main one ("Pick another handle"): big enough to read and tap. */
export const linkButtonSx: SxProps<Theme> = { typography: 'h6', minHeight: (theme) => theme.spacing(7) };

/**
 * Where an error shows on a keypad screen. With `reserve`, the space is kept when there is no
 * error, so the keypad doesn't jump under a thumb when a wrong PIN comes back.
 */
export function ErrorSlot({ words, reserve = false }: { words: string | null; reserve?: boolean }) {
  return (
    <Box sx={{ width: '100%', minHeight: (theme) => (reserve ? theme.spacing(7) : 0) }}>
      {words && (
        <Alert severity="error" sx={{ typography: 'h6', justifyContent: 'center' }}>
          {words}
        </Alert>
      )}
    </Box>
  );
}
