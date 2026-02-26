import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Search, ChevronLeft, ChevronRight,
  ArrowUpRight, ChevronUp, ChevronDown,
} from 'lucide-react';
import api from '../services/api';
import { formatDate, priorityLabel, statusLabel, statusBadgeClass, priorityBadgeClass } from '../utils';
import type { IncidentListItem, PaginatedResponse } from '../types';
import { getIncidentTypeShort } from '../constants/incidentTypes';

type SortKey = 'rusiem_incident_id' | 'published_at' | 'title' | 'priority' | 'status' | 'category';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = {
  new: 0, in_progress: 1, awaiting_customer: 2, awaiting_soc: 3, resolved: 4, closed: 5, false_positive: 6,
};

export default function IncidentsPage() {
  const [data, setData] = useState<PaginatedResponse<IncidentListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('published_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, per_page: 20 };
      if (filterStatus) params.status = filterStatus;
      if (filterPriority) params.priority = filterPriority;
      const { data: resp } = await api.get('/incidents/', { params });
      setData(resp);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterPriority]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = data?.items?.filter((i) =>
    !search || i.title.toLowerCase().includes(search.toLowerCase())
      || String(i.rusiem_incident_id).includes(search)
  ) ?? [];

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'published_at' ? 'desc' : 'asc');
    }
  };

  const sortedItems = useMemo(() => {
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'rusiem_incident_id':
          cmp = a.rusiem_incident_id - b.rusiem_incident_id;
          break;
        case 'published_at':
          cmp = new Date(a.published_at).getTime() - new Date(b.published_at).getTime();
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
        case 'category':
          cmp = (a.category || '').localeCompare(b.category || '', 'ru');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filtered, sortKey, sortDir]);

  return (
    <div className="space-y-5 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">Инциденты</h1>
          <p className="text-sm text-surface-500 mt-1">
            {loading ? 'Загрузка...' : data ? `${data.total} инцидентов` : 'Нет данных'}
          </p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
            placeholder="Поиск по названию или ID..."
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
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
          onChange={(e) => { setFilterPriority(e.target.value); setPage(1); }}
          className="input w-auto min-w-[140px]"
        >
          <option value="">Все приоритеты</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-800">
              <SortTh label="ID" sortKey="rusiem_incident_id" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Дата создания" sortKey="published_at" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Инцидент" sortKey="title" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Приоритет" sortKey="priority" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Статус" sortKey="status" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Тип" sortKey="category" current={sortKey} dir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-surface-800/50">
                  <td colSpan={6} className="px-4 py-4">
                    <div className="h-4 bg-surface-800 rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
                  </td>
                </tr>
              ))
            ) : sortedItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
                  <AlertTriangle className="w-8 h-8 text-surface-700 mx-auto mb-2" />
                  <p className="text-sm text-surface-500">Инцидентов не найдено</p>
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
                    <span className={`badge ${priorityBadgeClass[item.priority] || ''}`}>
                      {priorityLabel[item.priority] || item.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${statusBadgeClass[item.status] || ''}`}>
                      {statusLabel[item.status] || item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-surface-500">
                      {getIncidentTypeShort(item.category)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-500">
            Стр. {data.page} из {data.pages}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="btn-ghost p-2 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(Math.min(data.pages, page + 1))}
              disabled={page >= data.pages}
              className="btn-ghost p-2 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortTh({
  label, sortKey, current, dir, onSort,
}: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
        active ? 'text-brand-400' : 'text-surface-500 hover:text-surface-300'
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}
