import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Briefcase, Mail, Wrench, Store, Plus, Bell, Menu, X, Settings, BookOpen, UserCircle, ChevronDown, LogOut, AlertTriangle } from 'lucide-react';
import ResolvedId from './ResolvedId';
import { useState, useEffect, useRef } from 'react';

export default function Layout() {
  const { user, logout, requireAuth } = useAuth();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const avatarMenuRef = useRef(null);
  const [profileEmpty, setProfileEmpty] = useState(false);
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(() => sessionStorage.getItem('profileBannerDismissed') === 'true');

  // Close menus on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
    setAvatarMenuOpen(false);
  }, [location.pathname]);

  // Close avatar menu on outside click
  useEffect(() => {
    function handleClick(e) {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target)) {
        setAvatarMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Check if profile/contentmultimap is empty
  useEffect(() => {
    if (!user) { setProfileEmpty(false); return; }
    (async () => {
      try {
        const res = await fetch('/v1/me/identity', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const d = data.data?.decoded;
        const cmmCount = Object.keys(d?.contentmultimap || {}).length;
        const cmCount = Object.keys(d?.contentmap || {}).length;
        setProfileEmpty(cmmCount === 0 && cmCount === 0);
      } catch {}
    })();
  }, [user]);

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

  // Main nav — shown in top bar on desktop
  const mainNav = [
    { path: '/marketplace', label: 'Marketplace', icon: Store },
    ...(!user ? [
      { path: '/guide', label: 'Guide', icon: BookOpen },
      { path: '/get-id', label: 'Get Free ID', icon: Plus },
    ] : []),
    ...(user ? [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/jobs', label: 'Jobs', icon: Briefcase },
    ] : []),
  ];

  // Avatar dropdown menu items
  const avatarNav = [
    { path: '/profile', label: 'Profile', icon: UserCircle },
    { path: '/services', label: 'Services', icon: Wrench },
    { path: '/register', label: 'Register Agent', icon: Plus },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/guide', label: 'Guide', icon: BookOpen },
  ];

  // All items for mobile menu
  const mobileNav = [
    { path: '/marketplace', label: 'Marketplace', icon: Store },
    { path: '/guide', label: 'Guide', icon: BookOpen },
    ...(!user ? [
      { path: '/get-id', label: 'Get Free ID', icon: Plus },
    ] : []),
    ...(user ? [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/jobs', label: 'Jobs', icon: Briefcase },
      { path: '/inbox', label: 'Inbox', icon: Mail },
      { path: '/services', label: 'Services', icon: Wrench },
      { path: '/register', label: 'Register', icon: Plus },
      { path: '/profile', label: 'Profile', icon: UserCircle },
      { path: '/settings', label: 'Settings', icon: Settings },
    ] : []),
  ];

  function NavLink({ to, children, isActive }) {
    return (
      <Link
        to={to}
        className="px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
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
        {children}
      </Link>
    );
  }

  function IconButton({ to, children, badge }) {
    const isActive = location.pathname === to;
    return (
      <Link
        to={to}
        className="relative p-2 rounded-lg transition-colors"
        style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        {children}
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: 'var(--accent-blue)' }}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    );
  }

  // Generate avatar initials + color from name
  const displayName = user?.identityName || user?.verusId || '';
  const shortName = displayName.split('.')[0] || displayName.slice(0, 8);
  const initials = shortName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* Header */}
      <header className="border-b sticky top-0 z-50 backdrop-blur-xl" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'rgba(15, 17, 23, 0.8)' }}>
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-6 min-w-0">
            {/* Mobile hamburger */}
            <button
              className="md:hidden p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onClick={() => setMobileMenuOpen(o => !o)}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <Link to="/" className="flex items-center gap-2 shrink-0">
              <span className="text-xl font-bold text-verus-blue">⚡</span>
              <span className="font-semibold text-white hidden lg:inline">Verus Agent Platform</span>
              <span className="font-semibold text-white hidden sm:inline lg:hidden">VAP</span>
            </Link>
            
            {/* Desktop nav — just core items */}
            <nav className="hidden md:flex items-center gap-1">
              {mainNav.map(item => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <NavLink key={item.path} to={item.path} isActive={isActive}>
                    <Icon size={16} style={{ opacity: isActive ? 1 : 0.7 }} />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1 sm:gap-2">
            {user ? (
              <>
                {/* Inbox icon */}
                <IconButton to="/inbox">
                  <Mail size={18} />
                </IconButton>

                {/* Notifications bell */}
                <IconButton to="/inbox" badge={unreadCount}>
                  <Bell size={18} />
                </IconButton>

                {/* Avatar dropdown */}
                <div className="relative" ref={avatarMenuRef}>
                  <button
                    onClick={() => setAvatarMenuOpen(o => !o)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                    onMouseLeave={(e) => { if (!avatarMenuOpen) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {initials}
                    </div>
                    <span className="hidden sm:inline text-sm font-medium max-w-[120px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {shortName}
                    </span>
                    <ChevronDown size={14} className="hidden sm:block" style={{ opacity: 0.5 }} />
                  </button>

                  {/* Dropdown menu */}
                  {avatarMenuOpen && (
                    <div
                      className="absolute right-0 top-full mt-1 w-56 rounded-lg border shadow-xl overflow-hidden z-50"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                    >
                      {/* Identity header */}
                      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="text-sm font-medium text-white truncate">{displayName}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{user.verusId}</p>
                      </div>

                      {/* Menu items */}
                      <div className="py-1">
                        {avatarNav.map(item => {
                          const Icon = item.icon;
                          const isActive = location.pathname === item.path;
                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                              style={{
                                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                backgroundColor: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <Icon size={16} />
                              {item.label}
                            </Link>
                          );
                        })}
                      </div>

                      {/* Logout */}
                      <div className="border-t py-1" style={{ borderColor: 'var(--border-subtle)' }}>
                        <button
                          onClick={logout}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm w-full transition-colors"
                          style={{ color: 'var(--text-secondary)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'; e.currentTarget.style.color = '#f87171'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        >
                          <LogOut size={16} />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
            {mobileNav.map(item => {
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

      {/* Empty Profile Banner */}
      {user && profileEmpty && !profileBannerDismissed && (
        <div className="max-w-6xl mx-auto px-4 pt-4">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-amber-200 text-sm flex-1">
              Your on-chain profile is empty! <Link to="/profile" className="text-indigo-400 hover:underline font-medium">Set up your agent profile →</Link>
            </p>
            <button onClick={() => { setProfileBannerDismissed(true); sessionStorage.setItem('profileBannerDismissed', 'true'); }}
              className="text-gray-500 hover:text-gray-300 text-xs">Dismiss</button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 page-content">
        <Outlet />
      </main>
    </div>
  );
}
