import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  AlertTriangle, Shield, Server, Clock, TrendingUp,
  ArrowUpRight, Activity,
} from 'lucide-react';
import api from '../services/api';
import { formatMinutes } from '../utils';
import type { DashboardSummary, ChartDataPoint } from '../types';

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [chart, setChart] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/summary'),
      api.get('/dashboard/incidents-chart?period=14d'),
    ])
      .then(([s, c]) => {
        setSummary(s.data);
        setChart(c.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <PageSkeleton />;
  }

  if (!summary) {
    return <EmptyState />;
  }

  const { incidents, sla, sources } = summary;

  const pieData = Object.entries(incidents.by_priority)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v }));

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-surface-100">Дашборд</h1>
        <p className="text-sm text-surface-500 mt-1">Обзор состояния безопасности</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          icon={AlertTriangle}
          label="Открытых инцидентов"
          value={incidents.open}
          accent={incidents.open > 0 ? 'text-severity-high' : 'text-status-resolved'}
          sub={`${incidents.total} всего`}
        />
        <KPICard
          icon={Clock}
          label="MTTA (ср. время реакции)"
          value={formatMinutes(sla.mtta_minutes)}
          accent="text-brand-400"
          sub="за 30 дней"
        />
        <KPICard
          icon={TrendingUp}
          label="MTTR (ср. время решения)"
          value={formatMinutes(sla.mttr_minutes)}
          accent="text-brand-400"
          sub="за 30 дней"
        />
        <KPICard
          icon={Shield}
          label="SLA Compliance"
          value={sla.compliance_pct !== null ? `${sla.compliance_pct}%` : '—'}
          accent={
            sla.compliance_pct !== null && sla.compliance_pct >= 95
              ? 'text-status-resolved'
              : 'text-severity-medium'
          }
          sub="целевой: 95%"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Incidents over time */}
        <div className="col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-surface-300">Инциденты за 14 дней</h2>
            <Activity className="w-4 h-4 text-surface-600" />
          </div>
          <div className="h-64">
            {chart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} barCategoryGap="20%">
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => d.slice(5)}
                    tick={{ fill: '#657591', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#657591', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#1a1d27',
                      border: '1px solid #394253',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#8593ab' }}
                  />
                  <Bar dataKey="critical" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="high" stackId="a" fill="#f97316" />
                  <Bar dataKey="medium" stackId="a" fill="#eab308" />
                  <Bar dataKey="low" stackId="a" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-surface-600 text-sm">
                Нет данных за период
              </div>
            )}
          </div>
        </div>

        {/* Priority distribution */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-300 mb-4">По приоритету</h2>
          {pieData.length > 0 ? (
            <>
              <div className="h-44 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={PRIORITY_COLORS[entry.name] || '#6b7280'} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-2">
                {Object.entries(incidents.by_priority).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: PRIORITY_COLORS[k] }}
                      />
                      <span className="text-surface-400 capitalize">{k}</span>
                    </div>
                    <span className="text-surface-200 font-medium font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-44 flex items-center justify-center text-surface-600 text-sm">
              Нет инцидентов
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: status breakdown + sources */}
      <div className="grid grid-cols-2 gap-4">
        {/* Status breakdown */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-300 mb-4">По статусу</h2>
          <div className="space-y-3">
            {Object.entries(incidents.by_status).map(([status, count]) => {
              const pct = incidents.total > 0 ? (count / incidents.total) * 100 : 0;
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-surface-400">{statusLabels[status] || status}</span>
                    <span className="text-surface-200 font-mono">{count}</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: statusColors[status] || '#6b7280',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sources health */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-surface-300">Источники логов</h2>
            <Server className="w-4 h-4 text-surface-600" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SourceStat label="Всего" value={sources.total} color="text-surface-200" />
            <SourceStat label="Активных" value={sources.active} color="text-emerald-400" />
            <SourceStat label="Деградация" value={sources.degraded} color="text-amber-400" />
            <SourceStat label="Нет логов" value={sources.no_logs} color="text-red-400" />
          </div>
          {sources.error > 0 && (
            <div className="mt-4 px-3 py-2 bg-red-400/10 border border-red-400/20 rounded-lg text-sm text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {sources.error} источник(ов) с ошибками
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function KPICard({
  icon: Icon, label, value, accent, sub,
}: {
  icon: React.ElementType; label: string; value: string | number; accent: string; sub: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-surface-500" />
        <span className="text-xs font-medium text-surface-500">{label}</span>
      </div>
      <p className={`text-2xl font-semibold font-mono ${accent}`}>{value}</p>
      <p className="text-xs text-surface-600 mt-1">{sub}</p>
    </div>
  );
}

function SourceStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center py-3 bg-surface-800/50 rounded-lg">
      <p className={`text-xl font-semibold font-mono ${color}`}>{value}</p>
      <p className="text-xs text-surface-500 mt-0.5">{label}</p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-surface-800 rounded" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card p-4 h-28" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 card h-80" />
        <div className="card h-80" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center">
      <Shield className="w-12 h-12 text-surface-700 mb-4" />
      <h2 className="text-lg font-medium text-surface-400">Нет данных</h2>
      <p className="text-sm text-surface-600 mt-1">Инциденты ещё не опубликованы</p>
    </div>
  );
}

const statusLabels: Record<string, string> = {
  new: 'Новые',
  in_progress: 'В работе',
  awaiting_customer: 'Ожидание клиента',
  resolved: 'Решённые',
  closed: 'Закрытые',
};

const statusColors: Record<string, string> = {
  new: '#818cf8',
  in_progress: '#38bdf8',
  awaiting_customer: '#fbbf24',
  resolved: '#34d399',
  closed: '#6b7280',
};
