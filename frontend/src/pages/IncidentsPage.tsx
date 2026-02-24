import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Search, Filter, ChevronLeft, ChevronRight,
  MessageSquare, ArrowUpRight,
} from 'lucide-react';
import api from '../services/api';
import { timeAgo, priorityLabel, statusLabel, statusBadgeClass, priorityBadgeClass } from '../utils';
import type { IncidentListItem, PaginatedResponse, Priority, IncidentStatus } from '../types';
import { getIncidentTypeShort } from '../constants/incidentTypes';

export default function IncidentsPage() {
  const [data, setData] = useState<PaginatedResponse<IncidentListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [search, setSearch] = useState('');

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = data?.items?.filter((i) =>
    !search || i.title.toLowerCase().includes(search.toLowerCase())
      || String(i.rusiem_incident_id).includes(search)
  ) ?? [];

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
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">ID</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Инцидент</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Приоритет</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Статус</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Тип</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Время</th>
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
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
                  <AlertTriangle className="w-8 h-8 text-surface-700 mx-auto mb-2" />
                  <p className="text-sm text-surface-500">Инцидентов не найдено</p>
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-surface-500">
                      #{item.rusiem_incident_id}
                    </span>
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
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {item.comments_count > 0 && (
                        <span className="flex items-center gap-1 text-xs text-surface-500">
                          <MessageSquare className="w-3 h-3" />
                          {item.comments_count}
                        </span>
                      )}
                      <span className="text-xs text-surface-500">{timeAgo(item.published_at)}</span>
                    </div>
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
