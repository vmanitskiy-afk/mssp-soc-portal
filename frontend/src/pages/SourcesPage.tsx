import { useEffect, useState } from 'react';
import {
  Server, Activity, AlertTriangle, CheckCircle, XCircle,
  Clock, Gauge,
} from 'lucide-react';
import api from '../services/api';
import { timeAgo } from '../utils';
import type { LogSource } from '../types';

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  active: { icon: CheckCircle, color: 'text-emerald-400', label: 'Активен' },
  degraded: { icon: AlertTriangle, color: 'text-amber-400', label: 'Деградация' },
  no_logs: { icon: XCircle, color: 'text-red-400', label: 'Нет логов' },
  error: { icon: XCircle, color: 'text-red-500', label: 'Ошибка' },
  unknown: { icon: Clock, color: 'text-surface-500', label: 'Неизвестен' },
};

export default function SourcesPage() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/sources/')
      .then(({ data }) => setSources(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    total: sources.length,
    active: sources.filter((s) => s.status === 'active').length,
    issues: sources.filter((s) => ['degraded', 'no_logs', 'error'].includes(s.status)).length,
  };

  return (
    <div className="space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold text-surface-100">Источники логов</h1>
        <p className="text-sm text-surface-500 mt-1">Мониторинг подключённых источников</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-surface-800 flex items-center justify-center">
            <Server className="w-5 h-5 text-surface-400" />
          </div>
          <div>
            <p className="text-2xl font-semibold font-mono text-surface-100">{counts.total}</p>
            <p className="text-xs text-surface-500">Всего источников</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-semibold font-mono text-emerald-400">{counts.active}</p>
            <p className="text-xs text-surface-500">Активных</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-semibold font-mono text-red-400">{counts.issues}</p>
            <p className="text-xs text-surface-500">Проблемных</p>
          </div>
        </div>
      </div>

      {/* Source cards grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <div className="card p-16 text-center">
          <Server className="w-10 h-10 text-surface-700 mx-auto mb-3" />
          <p className="text-surface-400">Источники не настроены</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sources.map((s) => {
            const cfg = statusConfig[s.status] || statusConfig.unknown;
            const StatusIcon = cfg.icon;
            return (
              <div key={s.id} className="card p-4 flex items-start gap-3 hover:border-surface-700 transition-colors">
                <StatusIcon className={`w-5 h-5 mt-0.5 shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-medium text-surface-200 truncate">{s.name}</h3>
                    <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <p className="text-xs text-surface-500 font-mono truncate">{s.host}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-surface-500">
                    <span>{s.source_type}</span>
                    {s.vendor && <span>{s.vendor}</span>}
                    {s.eps !== null && (
                      <span className="flex items-center gap-1">
                        <Gauge className="w-3 h-3" />
                        {s.eps} EPS
                      </span>
                    )}
                    {s.last_event_at && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeAgo(s.last_event_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
