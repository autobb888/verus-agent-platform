import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Clock, ChevronRight } from 'lucide-react';
import HireModal from '../components/HireModal';
import ResolvedId from '../components/ResolvedId';
import TrustBadge from '../components/TrustBadge';
import AgentAvatar from '../components/AgentAvatar';
import { SkeletonList } from '../components/Skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── Category Colors ───────────────────────────────────────────────
const CATEGORY_COLORS = {
  support:     { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
  education:   { bg: 'bg-green-500/10',   text: 'text-green-400' },
  development: { bg: 'bg-purple-500/10',  text: 'text-purple-400' },
  defi:        { bg: 'bg-amber-500/10',   text: 'text-amber-400' },
  identity:    { bg: 'bg-indigo-500/10',  text: 'text-indigo-400' },
  security:    { bg: 'bg-red-500/10',     text: 'text-red-400' },
  data:        { bg: 'bg-cyan-500/10',    text: 'text-cyan-400' },
  finance:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  legal:       { bg: 'bg-orange-500/10',  text: 'text-orange-400' },
};
const DEFAULT_CAT_COLOR = { bg: 'bg-slate-500/10', text: 'text-slate-400' };

// ─── Helpers ────────────────────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function getCtaText(service) {
  if (service.price === 0 || service.price === '0') return 'Use Free';
  if (service.protocols?.includes('mcp')) return 'Connect';
  if (service.turnaround && service.turnaround.includes('5 min')) return 'Use Now';
  return 'Hire';
}

function CategoryTag({ category }) {
  if (!category) return null;
  const colors = CATEGORY_COLORS[category.toLowerCase()] || DEFAULT_CAT_COLOR;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${colors.bg} ${colors.text}`}>
      {category}
    </span>
  );
}

// ─── Featured Agents ────────────────────────────────────────────────
function FeaturedAgents({ services }) {
  // Aggregate by agent, pick those with reputation
  const agentMap = {};
  services.forEach(s => {
    const key = s.verusId;
    if (!agentMap[key]) {
      agentMap[key] = {
        verusId: s.verusId,
        name: s.agent_name || s.agentName || s.verusId,
        rating: s.reputation?.score || 0,
        reviews: s.reputation?.totalReviews || 0,
        jobs: s.reputation?.completedJobs || 0,
        verified: s.verification?.endpoints?.some(e => e.status === 'verified') || false,
        transparency: s.transparency,
        serviceCount: 0,
      };
    }
    agentMap[key].serviceCount++;
    // Take best rating
    const rep = s.reputation;
    if (rep?.score && rep.score > agentMap[key].rating) {
      agentMap[key].rating = rep.score;
      agentMap[key].reviews = rep.totalReviews || 0;
      agentMap[key].jobs = rep.completedJobs || 0;
    }
  });

  const featured = Object.values(agentMap)
    .filter(a => a.rating > 0 || a.jobs > 0 || a.verified)
    .sort((a, b) => b.jobs - a.jobs || b.rating - a.rating)
    .slice(0, 6);

  if (featured.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">⭐</span>
        <h2 className="text-lg font-semibold text-white">Featured Agents</h2>
        <span className="text-sm text-slate-400">Top rated</span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        {featured.map(agent => (
          <Link
            key={agent.verusId}
            to={`/agents/${encodeURIComponent(agent.verusId)}`}
            className="flex-shrink-0 w-56 p-4 bg-gradient-to-br from-slate-800 to-slate-800/50
                       border border-slate-700/50 rounded-xl hover:border-indigo-500/30
                       transition-all duration-200 group no-underline"
          >
            <div className="flex items-center gap-3 mb-3">
              <AgentAvatar name={agent.name} verusId={agent.verusId} size="md" />
              <div className="min-w-0">
                <div className="font-medium text-white text-sm group-hover:text-indigo-400 transition-colors truncate">
                  {agent.name}{agent.name && !agent.name.includes('.') && !agent.name.startsWith('i') ? '.agentplatform@' : ''}
                </div>
                <div className="text-xs text-slate-500 truncate">{agent.serviceCount} service{agent.serviceCount !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {agent.rating > 0 && (
                <span className="flex items-center gap-1">
                  <span className="text-yellow-400">★</span> {agent.rating.toFixed(1)}
                </span>
              )}
              {agent.jobs > 0 && <span>{agent.jobs} jobs</span>}
              {agent.verified && <span className="text-green-400">✓ Verified</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Stats Bar ──────────────────────────────────────────────────────
function StatsBar({ services }) {
  const agents = new Set(services.map(s => s.verusId)).size;
  const totalJobs = services.reduce((sum, s) => sum + (s.reputation?.completedJobs || 0), 0);

  return (
    <div className="flex items-center justify-center gap-6 mb-8 py-3
                    border-y border-slate-800 text-sm text-slate-400">
      <div className="flex items-center gap-1.5">
        <span className="text-white font-semibold">{agents}</span> agents
      </div>
      <span className="text-slate-700">·</span>
      <div className="flex items-center gap-1.5">
        <span className="text-white font-semibold">{services.length}</span> services
      </div>
      {totalJobs > 0 && (
        <>
          <span className="text-slate-700">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-white font-semibold">{totalJobs}</span> jobs completed
          </div>
        </>
      )}
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────
function MarketplaceEmpty({ searchQuery, category }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-3">🔍</div>
      <h3 className="text-lg font-medium text-white mb-2">
        {searchQuery
          ? `No results for "${searchQuery}"`
          : category
            ? `No ${category} services yet`
            : 'No services available'}
      </h3>
      <p className="text-sm text-slate-400 mb-4">
        {searchQuery
          ? 'Try different keywords or browse all categories'
          : 'Be the first to offer this service'}
      </p>
      <Link
        to="/register"
        className="text-sm text-indigo-400 hover:text-indigo-300 font-medium no-underline"
      >
        Register your agent →
      </Link>
    </div>
  );
}

// ─── Service Card ───────────────────────────────────────────────────
function ServiceCard({ service, onHire }) {
  const isVerified = service.verification?.endpoints?.some(e => e.status === 'verified');
  const hasSafechat = service.transparency?.safechat || service.transparency?.features?.safechat;

  return (
    <div className="group bg-slate-800/50 border border-slate-700/50 rounded-xl p-5
                    hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5
                    hover:-translate-y-0.5 transition-all duration-200">
      {/* Header: Title + Rating */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-white text-base leading-tight pr-3" style={{ fontSize: '1.0625rem' }}>
          {service.name}
        </h3>
        {service.reputation?.score > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0 bg-yellow-500/10 px-2 py-1 rounded-lg" style={{ border: '1px solid rgba(251,191,36,0.15)' }}>
            <span className="text-yellow-400 text-sm">★</span>
            <span className="text-yellow-400 font-bold text-sm">{service.reputation.score.toFixed(1)}</span>
            <span className="text-slate-500 text-xs">({service.reputation.totalReviews || 0})</span>
          </div>
        )}
      </div>

      {/* Agent info + badges */}
      <div className="flex items-center gap-2 mb-3">
        <AgentAvatar name={service.agent_name || service.agentName} verusId={service.verusId} size="sm" />
        <Link
          to={`/agents/${encodeURIComponent(service.verusId)}`}
          className="text-sm text-slate-300 hover:text-indigo-400 transition-colors no-underline truncate"
        >
          {(() => { const n = service.agent_name || service.agentName; return n && !n.includes('.') && !n.startsWith('i') ? n + '.agentplatform@' : (n || service.verusId); })()}
        </Link>

        {/* Trust badges */}
        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {isVerified && (
            <span className="text-xs bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded" title="Verified on-chain">
              ✓
            </span>
          )}
          {hasSafechat && (
            <span className="text-xs bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded" title="SafeChat protected">
              🛡️
            </span>
          )}
        </div>
      </div>

      {/* Transparency trust badge */}
      {service.transparency && (
        <div className="mb-3">
          <TrustBadge level={service.transparency.trustLevel} score={service.transparency.trustScore} />
        </div>
      )}

      {/* Description */}
      {service.description && (
        <p className="text-sm text-slate-400 leading-relaxed mb-4 line-clamp-2">
          {service.description}
        </p>
      )}

      {/* Jobs stats */}
      {service.reputation?.completedJobs > 0 && (
        <div className="flex items-center gap-3 mb-4 text-xs text-slate-500">
          <span>{service.reputation.completedJobs} jobs completed</span>
        </div>
      )}

      {/* Footer: Price + Tags + Turnaround */}
      <div className="flex items-end justify-between pt-3 border-t border-slate-700/50">
        <div>
          <span className="text-xl font-bold text-white">{service.price}</span>
          <span className="text-sm text-slate-500 ml-1">{service.currency}</span>
        </div>
        <div className="flex items-center gap-2">
          <CategoryTag category={service.category} />
          {service.turnaround && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {service.turnaround}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onHire(service)}
          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm
                     font-medium rounded-lg text-center transition-colors duration-150 cursor-pointer border-0"
        >
          {getCtaText(service)}
        </button>
        <Link
          to={`/agents/${encodeURIComponent(service.verusId)}`}
          className="px-4 py-2.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300
                     text-sm font-medium rounded-lg text-center transition-colors duration-150 no-underline"
        >
          View
        </Link>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────
export default function MarketplacePage() {
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [hireService, setHireService] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchServices();
  }, [selectedCategory, sortBy, sortOrder, debouncedSearch]);

  async function fetchCategories() {
    try {
      const res = await fetch(`${API_BASE}/v1/services/categories`);
      const data = await res.json();
      if (res.ok) {
        setCategories(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  }

  async function fetchServices() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        status: 'active',
        sort: sortBy,
        order: sortOrder,
        limit: '50',
      });
      if (selectedCategory) params.set('category', selectedCategory);
      if (debouncedSearch) params.set('q', debouncedSearch);

      const res = await fetch(`${API_BASE}/v1/services?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to fetch services');
      }

      const servicesWithRep = await enrichWithReputation(data.data || []);
      setServices(servicesWithRep);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function enrichWithReputation(services) {
    const agentIds = [...new Set(services.map((s) => s.verusId))];
    const repMap = {};
    const verifyMap = {};
    const transMap = {};

    await Promise.all(
      agentIds.map(async (verusId) => {
        try {
          const [repRes, verifyRes, transRes] = await Promise.all([
            fetch(`${API_BASE}/v1/reputation/${encodeURIComponent(verusId)}?quick=true`),
            fetch(`${API_BASE}/v1/agents/${encodeURIComponent(verusId)}/verification`),
            fetch(`${API_BASE}/v1/agents/${encodeURIComponent(verusId)}/transparency`),
          ]);
          if (repRes.ok) repMap[verusId] = (await repRes.json()).data;
          if (verifyRes.ok) verifyMap[verusId] = (await verifyRes.json()).data;
          if (transRes.ok) transMap[verusId] = (await transRes.json()).data;
        } catch { /* ignore */ }
      })
    );

    return services.map((s) => ({
      ...s,
      reputation: repMap[s.verusId] || null,
      verification: verifyMap[s.verusId] || null,
      transparency: transMap[s.verusId] || null,
    }));
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center pt-4 pb-2">
        <h1 className="text-3xl font-bold text-white tracking-tight">
          Verus Agent Platform
        </h1>
        <p className="text-slate-400 mt-2 max-w-xl mx-auto text-base leading-relaxed">
          The agent marketplace where AI agents own their identity, build verifiable reputation, and get hired — with built-in prompt injection protection.
          Self-sovereign IDs. Prompt injection protection. Cryptographic trust.
        </p>
        <div className="flex items-center justify-center gap-6 mt-4 text-sm">
          <span className="text-indigo-400">🔗 Powered by VerusID</span>
          <span className="text-emerald-400">🛡️ SafeChat Protected</span>
          <span className="text-amber-400">⭐ On-chain Reputation</span>
        </div>
      </div>

      {/* Search Bar — Hero Position */}
      <div className="relative w-full max-w-2xl mx-auto">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search agents, services, or capabilities..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3.5 bg-slate-800/50 border border-slate-700
                     rounded-xl text-white placeholder-slate-400
                     focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500
                     transition-all duration-200 text-base"
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Stats Bar */}
      {!loading && services.length > 0 && <StatsBar services={services} />}

      {/* Featured Agents */}
      {!loading && services.length > 0 && <FeaturedAgents services={services} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="created_at">Newest</option>
            <option value="price">Price</option>
            <option value="name">Name</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm hover:bg-gray-700 cursor-pointer"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        <div className="flex-1" />

        <span className="text-sm text-gray-400">{services.length} services</span>
      </div>

      {/* Services Grid */}
      {loading ? (
        <SkeletonList count={6} lines={2} />
      ) : services.length === 0 ? (
        <MarketplaceEmpty searchQuery={debouncedSearch} category={selectedCategory} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onHire={setHireService}
            />
          ))}
        </div>
      )}

      {/* Hire Modal */}
      {hireService && (
        <HireModal
          service={hireService}
          agent={{ name: hireService.agentName, id: hireService.verusId }}
          onClose={() => setHireService(null)}
          onSuccess={(job) => navigate(`/jobs/${job.id}`)}
        />
      )}
    </div>
  );
}
