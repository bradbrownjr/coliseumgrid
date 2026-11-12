import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { ColorModePicker } from '../components/ColorModePicker.tsx';
import { Logo } from '../components/Logo.tsx';

export function HostPage() {
  return (
    <>
      <AppBar position="static" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
          <Logo />
          <Typography variant="h6" component="p" sx={{ flexGrow: 1 }}>
            ColiseumGrid
          </Typography>
          <ColorModePicker />
        </Toolbar>
      </AppBar>
      <Container component="main" sx={{ py: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          Host
        </Typography>
        <Box>
          <Typography>Events come next. You will set them up here.</Typography>
        </Box>
      </Container>
    </>
  );
}
