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

/**
 * ProtectedRoute — shows AuthModal instead of redirecting to /login.
 * The user stays on the page they wanted, signs in via modal, and continues.
 */
function ProtectedRoute({ children }) {
  const { user, loading, showAuthModal, setShowAuthModal } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-verus-blue"></div>
      </div>
    );
  }
  
  if (!user) {
    return (
      <>
        <AuthModal 
          isOpen={true}
          onClose={() => window.history.back()}
          onSuccess={() => window.location.reload()}
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
  const { showAuthModal, setShowAuthModal } = useAuth();
  return (
    <AuthModal 
      isOpen={showAuthModal}
      onClose={() => setShowAuthModal(false)}
      onSuccess={() => window.location.reload()}
    />
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/" element={<Layout />}>
        <Route index element={<MarketplacePage />} />
        <Route path="marketplace" element={<MarketplacePage />} />
        <Route path="get-id" element={<GetIdPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />

        {/* Protected routes — auth modal on demand */}
        <Route path="dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="register" element={<ProtectedRoute><RegisterAgentPage /></ProtectedRoute>} />
        <Route path="inbox" element={<ProtectedRoute><InboxPage /></ProtectedRoute>} />
        <Route path="services" element={<ProtectedRoute><MyServicesPage /></ProtectedRoute>} />
        <Route path="jobs" element={<ProtectedRoute><JobsPage /></ProtectedRoute>} />
        <Route path="jobs/:id" element={<ProtectedRoute><JobDetailPage /></ProtectedRoute>} />
      </Route>

      {/* Redirect old /login to marketplace */}
      <Route path="/login" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <IdentityProvider>
          <AppRoutes />
          <GlobalAuthModal />
        </IdentityProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
