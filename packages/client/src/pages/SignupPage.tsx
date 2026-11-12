import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { Logo } from '../components/Logo.tsx';

/** Entry panels are centered on the screen (docs/DESIGN.md, "Sign-up"). */
export function SignupPage() {
  return (
    <Container
      component="main"
      maxWidth="sm"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        textAlign: 'center',
      }}
    >
      <Logo size={12} />
      <Typography variant="h3" component="h1">
        Sign up
      </Typography>
      <Typography>Players will pick a handle here. That comes next.</Typography>
    </Container>
  );
}
