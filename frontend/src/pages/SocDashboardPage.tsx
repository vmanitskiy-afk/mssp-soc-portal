import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Plus, ArrowUpRight, Clock, MessageSquare,
} from 'lucide-react';
import api from '../services/api';
import {
  timeAgo, priorityLabel, statusLabel, statusBadgeClass, priorityBadgeClass,
} from '../utils';
import type { IncidentListItem, PaginatedResponse } from '../types';

export default function SocDashboardPage() {
  const [data, setData] = useState<PaginatedResponse<IncidentListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { per_page: 30 };
      if (filterStatus) params.status = filterStatus;
      if (filterPriority) params.priority = filterPriority;
      const { data: resp } = await api.get('/soc/incidents', { params });
      setData(resp);
    } catch {}
    setLoading(false);
  }, [filterStatus, filterPriority]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Quick stats
  const items = data?.items || [];
  const openCount = items.filter((i) => !['closed', 'false_positive'].includes(i.status)).length;
  const criticalCount = items.filter((i) => i.priority === 'critical' && i.status !== 'closed').length;

  return (
    <div className="space-y-5 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">SOC — Обзор</h1>
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
      <div className="flex items-center gap-3">
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
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-800">
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">RuSIEM ID</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Инцидент</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Приоритет</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Статус</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Время</th>
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
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-surface-500">#{item.rusiem_incident_id}</span>
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
    </div>
  );
}
