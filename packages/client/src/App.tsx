import { Navigate, Route, Routes } from 'react-router';
import { DisplayPage } from './pages/DisplayPage.tsx';
import { HostPage } from './pages/HostPage.tsx';
import { JoinPage } from './pages/JoinPage.tsx';
import { SignupPage } from './pages/SignupPage.tsx';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<JoinPage />} />
      <Route path="/host" element={<HostPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
