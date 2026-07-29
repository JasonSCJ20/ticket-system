import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import ForgotUsername from './pages/ForgotUsername.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tickets from './pages/Tickets.jsx';
import Findings from './pages/Findings.jsx';
import Assets from './pages/Assets.jsx';
import SocFeed from './pages/SocFeed.jsx';
import Fortress from './pages/Fortress.jsx';
import Patches from './pages/Patches.jsx';
import Reports from './pages/Reports.jsx';
import Team from './pages/Team.jsx';
import Governance from './pages/Governance.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-username" element={<ForgotUsername />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/tickets" element={<Tickets />} />
              <Route path="/findings" element={<Findings />} />
              <Route path="/assets" element={<Assets />} />
              <Route path="/soc" element={<SocFeed />} />
              <Route path="/fortress" element={<Fortress />} />
              <Route path="/patches" element={<Patches />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/team" element={<Team />} />
              <Route path="/governance" element={<Governance />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
