import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Plus, ArrowUpRight,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import api from '../services/api';
import {
  formatDate, priorityLabel, statusLabel, statusBadgeClass, priorityBadgeClass,
} from '../utils';
import type { IncidentListItem, PaginatedResponse } from '../types';

type SortKey = 'rusiem_incident_id' | 'title' | 'priority' | 'status' | 'published_at';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = {
  new: 0, in_progress: 1, awaiting_customer: 2, awaiting_soc: 3, resolved: 4, closed: 5, false_positive: 6,
};

export default function SocDashboardPage() {
  const [data, setData] = useState<PaginatedResponse<IncidentListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tenants, setTenants] = useState<{ id: string; name: string; short_name: string }[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('published_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { per_page: 100 };
      if (filterStatus) params.status = filterStatus;
      if (filterPriority) params.priority = filterPriority;
      if (filterTenant) params.tenant_id = filterTenant;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo + 'T23:59:59';
      const { data: resp } = await api.get('/soc/incidents', { params });
      setData(resp);
    } catch {}
    setLoading(false);
  }, [filterStatus, filterPriority, filterTenant, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    api.get('/soc/tenants').then(({ data }) => setTenants(data.items || [])).catch(() => {});
  }, []);

  // Quick stats
  const items = data?.items || [];
  const openCount = items.filter((i) => !['closed', 'false_positive'].includes(i.status)).length;
  const criticalCount = items.filter((i) => i.priority === 'critical' && i.status !== 'closed').length;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'published_at' ? 'desc' : 'asc');
    }
  };

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'rusiem_incident_id':
          cmp = a.rusiem_incident_id - b.rusiem_incident_id;
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title, 'ru');
          break;
        case 'priority':
          cmp = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
          break;
        case 'status':
          cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
          break;
        case 'published_at':
          cmp = new Date(a.published_at).getTime() - new Date(b.published_at).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [items, sortKey, sortDir]);

  return (
    <div className="space-y-5 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">Инциденты</h1>
          <p className="text-sm text-surface-500 mt-1">
            Все инциденты по всем клиентам
          </p>
        </div>
        <Link to="/soc/publish" className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Опубликовать инцидент
        </Link>
      </div>

      {/* Quick stats row */}
      <div className="flex items-center gap-4">
        <div className="card px-4 py-2.5 flex items-center gap-2">
          <span className="text-sm text-surface-400">Всего:</span>
          <span className="text-sm font-semibold font-mono text-surface-100">{data?.total ?? '—'}</span>
        </div>
        <div className="card px-4 py-2.5 flex items-center gap-2">
          <span className="text-sm text-surface-400">Открытых:</span>
          <span className="text-sm font-semibold font-mono text-severity-high">{openCount}</span>
        </div>
        {criticalCount > 0 && (
          <div className="card px-4 py-2.5 flex items-center gap-2 border-severity-critical/30">
            <AlertTriangle className="w-4 h-4 text-severity-critical" />
            <span className="text-sm font-semibold font-mono text-severity-critical">{criticalCount} critical</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterTenant}
          onChange={(e) => setFilterTenant(e.target.value)}
          className="input w-auto min-w-[160px]"
        >
          <option value="">Все клиенты</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="input w-auto min-w-[160px]"
        >
          <option value="">Все статусы</option>
          <option value="new">Новые</option>
          <option value="in_progress">В работе</option>
          <option value="awaiting_customer">Ожидает клиента</option>
          <option value="awaiting_soc">Ожидает SOC</option>
          <option value="resolved">Решённые</option>
          <option value="closed">Закрытые</option>
          <option value="false_positive">Ложный</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="input w-auto min-w-[140px]"
        >
          <option value="">Все приоритеты</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-surface-500">с</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input w-auto text-xs py-1.5"
          />
          <span className="text-xs text-surface-500">по</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input w-auto text-xs py-1.5"
          />
        </div>
        {(filterStatus || filterPriority || filterTenant || dateFrom || dateTo) && (
          <button
            onClick={() => { setFilterStatus(''); setFilterPriority(''); setFilterTenant(''); setDateFrom(''); setDateTo(''); }}
            className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-800">
              <SortHeader label="RuSIEM ID" sortKey="rusiem_incident_id" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Дата создания" sortKey="published_at" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Инцидент" sortKey="title" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Приоритет" sortKey="priority" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Статус" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="border-b border-surface-800/50">
                  <td colSpan={5} className="px-4 py-4">
                    <div className="h-4 bg-surface-800 rounded animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <p className="text-sm text-surface-500">Инцидентов нет</p>
                </td>
              </tr>
            ) : (
              sortedItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-surface-500">#{item.rusiem_incident_id}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-surface-500">{formatDate(item.published_at)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/incidents/${item.id}`}
                      className="text-sm font-medium text-surface-200 hover:text-brand-400 transition-colors flex items-center gap-1.5"
                    >
                      {item.title}
                      <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${priorityBadgeClass[item.priority]}`}>
                      {priorityLabel[item.priority]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${statusBadgeClass[item.status]}`}>
                      {statusLabel[item.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label, sortKey, currentKey, dir, onSort, align = 'left',
}: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const active = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`${align === 'right' ? 'text-right' : 'text-left'} px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
        active ? 'text-brand-400' : 'text-surface-500 hover:text-surface-300'
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronUp className="w-3 h-3 opacity-0 group-hover:opacity-30" />
        )}
      </span>
    </th>
  );
}
