import { useEffect, useState, useCallback } from 'react';
import {
  Server, Activity, AlertTriangle, CheckCircle, XCircle,
  Clock, Gauge, Search, RefreshCw, Filter, HelpCircle,
  Wifi, WifiOff, ChevronDown,
} from 'lucide-react';
import api from '../services/api';
import { timeAgo } from '../utils';
import type { LogSource } from '../types';

const statusConfig: Record<string, { icon: React.ElementType; color: string; bg: string; label: string; desc: string }> = {
  active:   { icon: CheckCircle,   color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Активен',    desc: 'Логи поступают нормально' },
  degraded: { icon: AlertTriangle, color: 'text-amber-400',   bg: 'bg-amber-500/10',   label: 'Деградация', desc: 'Логи поступают с задержкой' },
  no_logs:  { icon: XCircle,       color: 'text-red-400',     bg: 'bg-red-500/10',     label: 'Нет логов',  desc: 'Логи не поступают >30 мин' },
  error:    { icon: XCircle,       color: 'text-red-500',     bg: 'bg-red-500/10',     label: 'Ошибка',     desc: 'Ошибка подключения или парсинга' },
  unknown:  { icon: HelpCircle,    color: 'text-surface-500', bg: 'bg-surface-500/10', label: 'Неизвестен', desc: 'Статус ещё не проверен' },
};

const AUTO_REFRESH_INTERVAL = 60_000; // 1 minute

export default function SourcesPage() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sourceTypes, setSourceTypes] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const fetchSources = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.source_type = typeFilter;

      const { data } = await api.get('/sources/', { params });
      setSources(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, statusFilter, typeFilter]);

  // Fetch source types for filter
  useEffect(() => {
    api.get('/sources/types')
      .then(({ data }) => setSourceTypes(data.items || []))
      .catch(() => {});
  }, []);

  // Fetch sources on filter change
  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  // Auto-refresh
  useEffect(() => {
    const timer = setInterval(() => fetchSources(true), AUTO_REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchSources]);

  const counts = {
    total: sources.length,
    active: sources.filter((s) => s.status === 'active').length,
    issues: sources.filter((s) => ['degraded', 'no_logs', 'error'].includes(s.status)).length,
  };

  const activeFilters = [statusFilter, typeFilter, search].filter(Boolean).length;

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">Источники логов</h1>
          <p className="text-sm text-surface-500 mt-1">
            Мониторинг подключённых источников
            {sources.length > 0 && <span className="text-surface-600"> · обновлено {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>}
          </p>
        </div>
        <button
          onClick={() => fetchSources(true)}
          disabled={refreshing}
          className="btn-ghost flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => { setStatusFilter(''); setShowFilters(false); }}
          className={`card p-4 flex items-center gap-3 transition-all hover:border-surface-600 ${!statusFilter ? 'ring-1 ring-brand-600/40' : ''}`}
        >
          <div className="w-10 h-10 rounded-lg bg-surface-800 flex items-center justify-center">
            <Server className="w-5 h-5 text-surface-400" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-semibold font-mono text-surface-100">{counts.total}</p>
            <p className="text-xs text-surface-500">Всего источников</p>
          </div>
        </button>
        <button
          onClick={() => { setStatusFilter(statusFilter === 'active' ? '' : 'active'); setShowFilters(false); }}
          className={`card p-4 flex items-center gap-3 transition-all hover:border-emerald-500/30 ${statusFilter === 'active' ? 'ring-1 ring-emerald-500/40' : ''}`}
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-semibold font-mono text-emerald-400">{counts.active}</p>
            <p className="text-xs text-surface-500">Активных</p>
          </div>
        </button>
        <button
          onClick={() => { setStatusFilter(statusFilter === 'no_logs' ? '' : 'no_logs'); setShowFilters(false); }}
          className={`card p-4 flex items-center gap-3 transition-all hover:border-red-500/30 ${statusFilter === 'no_logs' ? 'ring-1 ring-red-500/40' : ''}`}
        >
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
            <WifiOff className="w-5 h-5 text-red-400" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-semibold font-mono text-red-400">{counts.issues}</p>
            <p className="text-xs text-surface-500">С проблемами</p>
          </div>
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            placeholder="Поиск по имени, хосту, вендору..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary flex items-center gap-2 relative ${showFilters ? 'ring-1 ring-brand-600/40' : ''}`}
        >
          <Filter className="w-4 h-4" />
          Фильтры
          {activeFilters > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-brand-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {activeFilters}
            </span>
          )}
        </button>
      </div>

      {/* Filter dropdowns */}
      {showFilters && (
        <div className="card p-4 flex items-center gap-4 animate-in">
          <div className="flex-1">
            <label className="block text-xs text-surface-500 mb-1">Статус</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input text-sm"
            >
              <option value="">Все статусы</option>
              {Object.entries(statusConfig).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-surface-500 mb-1">Тип источника</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="input text-sm"
            >
              <option value="">Все типы</option>
              {sourceTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {(statusFilter || typeFilter || search) && (
            <button
              onClick={() => { setStatusFilter(''); setTypeFilter(''); setSearch(''); }}
              className="btn-ghost text-sm text-surface-400 mt-4"
            >
              Сбросить
            </button>
          )}
        </div>
      )}

      {/* Source cards grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card p-4 h-28 animate-pulse" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <div className="card p-16 text-center">
          <Server className="w-10 h-10 text-surface-700 mx-auto mb-3" />
          <p className="text-surface-400">
            {activeFilters > 0 ? 'Источники не найдены по заданным фильтрам' : 'Источники не настроены'}
          </p>
          {activeFilters > 0 && (
            <button
              onClick={() => { setStatusFilter(''); setTypeFilter(''); setSearch(''); }}
              className="text-brand-400 text-sm mt-2 hover:underline"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sources.map((s) => {
            const cfg = statusConfig[s.status] || statusConfig.unknown;
            const StatusIcon = cfg.icon;
            return (
              <div
                key={s.id}
                className="card p-4 hover:border-surface-700 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                    <StatusIcon className={`w-4.5 h-4.5 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className="text-sm font-medium text-surface-200 truncate">{s.name}</h3>
                      <span className={`text-xs font-medium ${cfg.color} shrink-0 ml-2`}>{cfg.label}</span>
                    </div>
                    <p className="text-xs text-surface-500 font-mono truncate">{s.host}</p>

                    <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs text-surface-500 bg-surface-800 px-2 py-0.5 rounded">
                        {s.source_type}
                      </span>
                      {s.vendor && (
                        <span className="inline-flex items-center gap-1 text-xs text-surface-500 bg-surface-800 px-2 py-0.5 rounded">
                          {s.vendor}{s.product ? ` / ${s.product}` : ''}
                        </span>
                      )}
                      {s.eps !== null && s.eps !== undefined && (
                        <span className="inline-flex items-center gap-1 text-xs text-surface-400">
                          <Gauge className="w-3 h-3" />
                          {s.eps.toFixed(1)} EPS
                        </span>
                      )}
                    </div>

                    {s.last_event_at && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-surface-500">
                        <Clock className="w-3 h-3" />
                        Последнее событие: {timeAgo(s.last_event_at)}
                      </div>
                    )}
                    {!s.last_event_at && s.status !== 'unknown' && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-red-400/70">
                        <Clock className="w-3 h-3" />
                        Событий не зафиксировано
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {!loading && sources.length > 0 && (
        <div className="card p-4">
          <p className="text-xs text-surface-500 mb-2 font-medium">Обозначения статусов:</p>
          <div className="flex items-center gap-6 flex-wrap">
            {Object.entries(statusConfig).map(([key, { icon: Icon, color, label, desc }]) => (
              <div key={key} className="flex items-center gap-1.5">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-xs text-surface-400">
                  <span className="font-medium">{label}</span> — {desc}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
