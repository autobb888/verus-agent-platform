import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Briefcase, Inbox, Wrench, Store, Plus, Bell, Menu, X, Settings, BookOpen } from 'lucide-react';
import ResolvedId from './ResolvedId';
import { useState, useEffect } from 'react';

export default function Layout() {
  const { user, logout, requireAuth } = useAuth();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!user) return;
    const fetchUnread = async () => {
      try {
        const res = await fetch('/v1/me/notifications?limit=1', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.meta?.unreadCount?.c || 0);
        }
      } catch {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Public items always visible, auth items only when logged in
  const navItems = [
    { path: '/', label: 'Marketplace', icon: Store },
    { path: '/guide', label: 'Guide', icon: BookOpen },
    ...(!user ? [
      { path: '/get-id', label: 'Get Free ID', icon: Plus },
    ] : []),
    ...(user ? [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/jobs', label: 'Jobs', icon: Briefcase },
      { path: '/inbox', label: 'Inbox', icon: Inbox },
      { path: '/services', label: 'Services', icon: Wrench },
      { path: '/register', label: 'Register', icon: Plus },
      { path: '/settings', label: 'Settings', icon: Settings },
    ] : []),
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* Header */}
      <header className="border-b sticky top-0 z-50 backdrop-blur-xl" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'rgba(15, 17, 23, 0.8)' }}>
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-8">
            {/* Mobile hamburger */}
            <button
              className="md:hidden p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onClick={() => setMobileMenuOpen(o => !o)}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <Link to="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-verus-blue">⚡</span>
              <span className="font-semibold text-white hidden sm:inline">Verus Agent Platform</span>
              <span className="font-semibold text-white sm:hidden">VAP</span>
            </Link>
            
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'text-white'
                        : 'hover:text-white'
                    }`}
                    style={{
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      backgroundColor: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }
                    }}
                  >
                    <Icon size={16} style={{ opacity: isActive ? 1 : 0.7 }} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <>
                <Link to="/inbox" className="relative p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: 'var(--accent-blue)' }}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Link>
                <ResolvedId
                  address={user?.verusId}
                  name={user?.identityName}
                  size="sm"
                />
                <button
                  onClick={logout}
                  className="text-sm transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={requireAuth}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <nav className="max-w-6xl mx-auto px-4 py-2 flex flex-col gap-1">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  }}
                >
                  <Icon size={18} style={{ opacity: isActive ? 1 : 0.7 }} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 page-content">
        <Outlet />
      </main>
    </div>
  );
}
