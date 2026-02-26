import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import {
  AlertTriangle, Shield, Server, Clock, TrendingUp,
  Tag,
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

interface SlaPoint {
  date: string;
  mtta_minutes: number | null;
  mttr_minutes: number | null;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [chart, setChart] = useState<ChartDataPoint[]>([]);
  const [slaHistory, setSlaHistory] = useState<SlaPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartPeriod, setChartPeriod] = useState('14d');

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/summary'),
      api.get(`/dashboard/incidents-chart?period=${chartPeriod}`),
      api.get('/dashboard/sla-history?period=30d'),
    ])
      .then(([s, c, h]) => {
        setSummary(s.data);
        setChart(c.data);
        setSlaHistory(Array.isArray(h.data) ? h.data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [chartPeriod]);

  if (loading) return <PageSkeleton />;
  if (!summary) return <EmptyState />;

  const { incidents, sla, sources, top_categories } = summary;

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
          accent={sla.compliance_pct !== null && sla.compliance_pct >= 95 ? 'text-status-resolved' : 'text-severity-medium'}
          sub="целевой: 95%"
        />
      </div>

      {/* Row 2: Incidents chart + Priority pie */}
      <div className="grid grid-cols-3 gap-4">
        {/* Incidents over time */}
        <div className="col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-surface-300">
              Инциденты за {chartPeriod === '1d' ? '24 часа' : chartPeriod === '7d' ? '7 дней' : chartPeriod === '14d' ? '14 дней' : '30 дней'}
            </h2>
            <div className="flex items-center gap-1 bg-surface-800 rounded-lg p-0.5">
              {(['1d', '7d', '14d', '30d'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    chartPeriod === p
                      ? 'bg-brand-600/20 text-brand-400 font-medium'
                      : 'text-surface-500 hover:text-surface-300'
                  }`}
                >
                  {p === '1d' ? '24ч' : p === '7d' ? '7д' : p === '14d' ? '14д' : '30д'}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64">
            {chart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} barCategoryGap="20%">
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#8593ab' }} />
                  <Bar dataKey="critical" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="high" stackId="a" fill="#f97316" />
                  <Bar dataKey="medium" stackId="a" fill="#eab308" />
                  <Bar dataKey="low" stackId="a" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty />
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
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} strokeWidth={0}>
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
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: PRIORITY_COLORS[k] }} />
                      <span className="text-surface-400 capitalize">{k}</span>
                    </div>
                    <span className="text-surface-200 font-medium font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-44 flex items-center justify-center text-surface-600 text-sm">Нет инцидентов</div>
          )}
        </div>
      </div>

      {/* Row 3: MTTA/MTTR trend + Use Cases */}
      <div className="grid grid-cols-3 gap-4">
        {/* MTTA/MTTR trend */}
        <div className="col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-surface-300">Тренд MTTA / MTTR (30 дней)</h2>
            <TrendingUp className="w-4 h-4 text-surface-600" />
          </div>
          <div className="h-52">
            {slaHistory.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slaHistory}>
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: '#8593ab' }}
                    formatter={(v: number) => [`${v} мин`]}
                  />
                  <Line type="monotone" dataKey="mtta_minutes" stroke="#3b82f6" strokeWidth={2} dot={false} name="MTTA" connectNulls />
                  <Line type="monotone" dataKey="mttr_minutes" stroke="#f97316" strokeWidth={2} dot={false} name="MTTR" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty />
            )}
          </div>
          <div className="flex items-center gap-6 mt-2 justify-center">
            <div className="flex items-center gap-2 text-xs text-surface-400">
              <span className="w-3 h-0.5 bg-blue-500 rounded" /> MTTA
            </div>
            <div className="flex items-center gap-2 text-xs text-surface-400">
              <span className="w-3 h-0.5 bg-orange-500 rounded" /> MTTR
            </div>
          </div>
        </div>

        {/* Use Cases / Categories */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-surface-300">Активные Use Cases</h2>
            <Tag className="w-4 h-4 text-surface-600" />
          </div>
          {(top_categories || []).length > 0 ? (
            <div className="space-y-3">
              {top_categories.map((cat, i) => {
                const maxCount = top_categories[0]?.count || 1;
                const pct = (cat.count / maxCount) * 100;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-surface-300 truncate max-w-[160px]" title={cat.category}>{cat.category}</span>
                      <div className="flex items-center gap-2">
                        {cat.open > 0 && (
                          <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">{cat.open} откр</span>
                        )}
                        <span className="text-surface-200 font-mono text-xs">{cat.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-brand-500/60 transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-surface-600 text-sm">
              Категории не определены
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Status breakdown + Sources */}
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
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: statusColors[status] || '#6b7280' }} />
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

/* ── Sub-components ───────────────────────────────────────────── */

const tooltipStyle = { background: '#1a1d27', border: '1px solid #394253', borderRadius: '8px', fontSize: '12px' };

function KPICard({ icon: Icon, label, value, accent, sub }: {
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

function ChartEmpty() {
  return <div className="h-full flex items-center justify-center text-surface-600 text-sm">Недостаточно данных</div>;
}

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-surface-800 rounded" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="card p-4 h-28" />)}
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
  new: 'Новые', in_progress: 'В работе', awaiting_customer: 'Ожидание клиента',
  resolved: 'Решённые', closed: 'Закрытые',
};

const statusColors: Record<string, string> = {
  new: '#818cf8', in_progress: '#38bdf8', awaiting_customer: '#fbbf24',
  resolved: '#34d399', closed: '#6b7280',
};
