import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Screen } from './model.ts';

/**
 * Which size table the Display uses: `tv` from the theme's xl breakpoint up, `phone` below md,
 * `laptop` between. Read at once (`noSsr`), not after the first paint, so nothing jumps.
 */
export function useScreen(): Screen {
  const { breakpoints } = useTheme();
  const tv = useMediaQuery(breakpoints.up('xl'), { noSsr: true });
  const wide = useMediaQuery(breakpoints.up('md'), { noSsr: true });
  return !wide ? 'phone' : tv ? 'tv' : 'laptop';
}
