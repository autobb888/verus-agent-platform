import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { IdentityProvider } from './context/IdentityContext';
import AuthModal from './components/AuthModal';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import AgentDetailPage from './pages/AgentDetailPage';
import RegisterAgentPage from './pages/RegisterAgentPage';
import InboxPage from './pages/InboxPage';
import MyServicesPage from './pages/MyServicesPage';
import JobsPage from './pages/JobsPage';
import JobDetailPage from './pages/JobDetailPage';
import MarketplacePage from './pages/MarketplacePage';
import GetIdPage from './pages/GetIdPage';
import LandingPage from './pages/LandingPage';
import SettingsPage from './pages/SettingsPage';
import GuidePage from './pages/GuidePage';
import ProfilePage from './pages/ProfilePage';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

/**
 * ProtectedRoute — shows AuthModal instead of redirecting to /login.
 * The user stays on the page they wanted, signs in via modal, and continues.
 */
function ProtectedRoute({ children }) {
  const { user, loading, refreshUser } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-verus-blue"></div>
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthModal
          isOpen={true}
          onClose={() => window.history.back()}
          onSuccess={() => refreshUser()}
        />
        {/* Show dimmed page behind the modal */}
        <div className="opacity-30 pointer-events-none">
          {children}
        </div>
      </>
    );
  }

  return children;
}

/**
 * Global AuthModal — triggered by requireAuth() from any component.
 */
function GlobalAuthModal() {
  const { showAuthModal, setShowAuthModal, refreshUser } = useAuth();
  return (
    <AuthModal
      isOpen={showAuthModal}
      onClose={() => setShowAuthModal(false)}
      onSuccess={() => { setShowAuthModal(false); refreshUser(); }}
    />
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/" element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="marketplace" element={<MarketplacePage />} />
        <Route path="get-id" element={<GetIdPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="guide" element={<GuidePage />} />

        {/* Protected routes — auth modal on demand */}
        <Route path="dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="register" element={<ProtectedRoute><RegisterAgentPage /></ProtectedRoute>} />
        <Route path="inbox" element={<ProtectedRoute><InboxPage /></ProtectedRoute>} />
        <Route path="services" element={<ProtectedRoute><MyServicesPage /></ProtectedRoute>} />
        <Route path="jobs" element={<ProtectedRoute><JobsPage /></ProtectedRoute>} />
        <Route path="jobs/:id" element={<ProtectedRoute><JobDetailPage /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

        {/* 404 catch-all */}
        <Route path="*" element={
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
            <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
            <p className="text-xl text-gray-400 mb-6">Page not found</p>
            <a href="/marketplace" className="text-verus-blue hover:underline">Browse the marketplace</a>
          </div>
        } />
      </Route>

      {/* Redirect old /login to marketplace */}
      <Route path="/login" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <IdentityProvider>
            <ToastProvider>
              <AppRoutes />
              <GlobalAuthModal />
            </ToastProvider>
          </IdentityProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
