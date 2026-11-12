import Box from '@mui/material/Box';
import logoDark from '../../../../assets/logo/logo-dark.svg';
import logoLight from '../../../../assets/logo/logo.svg';

interface LogoProps {
  /** The height in theme spacing units. The width follows. */
  size?: number;
}

/**
 * Shows the light mark in the light scheme and the dark mark in the dark scheme. Both are
 * in the page and CSS picks one, so it also works inside the TV route's `mode-dark` wrapper,
 * where the active scheme from useColorScheme is not the scheme on screen.
 */
export function Logo({ size = 6 }: LogoProps) {
  return (
    <>
      <Box
        component="img"
        src={logoLight}
        alt=""
        sx={[{ display: 'block', height: (theme) => theme.spacing(size) }, (theme) => theme.applyStyles('dark', { display: 'none' })]}
      />
      <Box
        component="img"
        src={logoDark}
        alt=""
        sx={[{ display: 'none', height: (theme) => theme.spacing(size) }, (theme) => theme.applyStyles('dark', { display: 'block' })]}
      />
    </>
  );
}
