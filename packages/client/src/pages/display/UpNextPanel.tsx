import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { UP_NEXT_COUNT, scaleType, upNextType, type UpNextEntry } from './model.ts';
import { useScreen } from './useScreen.ts';

/** The next matches or groups in the queue, in the Up next color (docs/DESIGN.md, "Colors"). */
export function UpNextPanel({ entries, empty }: { entries: UpNextEntry[]; empty: string }) {
  const next = entries.slice(0, UP_NEXT_COUNT);
  const listType = upNextType(useScreen());
  return (
    <Box
      component="section"
      sx={{ border: 2, borderColor: 'upNext.main', borderRadius: 1, px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography component="h2" sx={{ typography: scaleType('h5'), color: 'upNext.main', lineHeight: 1.25 }}>
        Up next
      </Typography>
      {next.length === 0 ? (
        <Typography sx={{ typography: listType, color: 'text.secondary' }}>{empty}</Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1, typography: listType, lineHeight: 1.25 }}>
          {next.map((entry) => (
            <Box component="li" key={entry.key} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: '0.5em' }}>
              {entry.prefix && (
                <Box component="span" sx={{ fontSize: '0.7em', color: 'text.secondary' }}>
                  {entry.prefix}
                </Box>
              )}
              {entry.names.map((name, index) => (
                <Box component="span" key={index} sx={{ display: 'contents' }}>
                  {index > 0 && entry.separator !== null && (
                    <Box component="span" sx={{ fontSize: '0.7em', color: 'text.secondary' }}>
                      {entry.separator}
                    </Box>
                  )}
                  <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
                    {name}
                    {entry.separator === null && index < entry.names.length - 1 && ','}
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
