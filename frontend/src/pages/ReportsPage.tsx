import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  FileText, Download, Calendar, Loader2, TrendingUp, Clock,
  Shield, Activity, Users, ChevronDown,
} from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth';
import type { Tenant } from '../types';

interface SlaPoint {
  date: string;
  mtta_minutes: number | null;
  mttr_minutes: number | null;
  compliance_pct: number | null;
  incidents_total: number;
}

interface SlaCurrent {
  mtta_minutes: number | null;
  mttr_minutes: number | null;
  compliance_pct: number | null;
}

const PERIOD_PRESETS = [
  { label: 'Текущий месяц', value: 'current_month' },
  { label: 'Прошлый месяц', value: 'last_month' },
  { label: 'Последние 90 дней', value: '90d' },
  { label: 'Текущий квартал', value: 'current_quarter' },
  { label: 'Произвольный', value: 'custom' },
];

function getPresetDates(preset: string): { from: string; to: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'current_month':
      return { from: fmtDate(new Date(y, m, 1)), to: fmtDate(today) };
    case 'last_month':
      return { from: fmtDate(new Date(y, m - 1, 1)), to: fmtDate(new Date(y, m, 0)) };
    case '90d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 90);
      return { from: fmtDate(d), to: fmtDate(today) };
    }
    case 'current_quarter': {
      const qStart = new Date(y, Math.floor(m / 3) * 3, 1);
      return { from: fmtDate(qStart), to: fmtDate(today) };
    }
    default:
      return { from: fmtDate(new Date(y, m, 1)), to: fmtDate(today) };
  }
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${Math.round(min)} мин`;
  if (min < 1440) return `${(min / 60).toFixed(1)} ч`;
  return `${(min / 1440).toFixed(1)} дн`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

async function extractError(err: unknown): Promise<string> {
  try {
    const resp = (err as { response?: { data?: Blob } })?.response?.data;
    if (resp instanceof Blob) {
      const text = await resp.text();
      const json = JSON.parse(text);
      return json.detail || 'Ошибка генерации отчёта';
    }
  } catch { /* ignore */ }
  return 'Ошибка генерации отчёта';
}

export default function ReportsPage() {
  const { user } = useAuthStore();
  const isSoc = user?.role?.startsWith('soc_') || false;

  const [preset, setPreset] = useState('current_month');
  const [periodFrom, setPeriodFrom] = useState(() => getPresetDates('current_month').from);
  const [periodTo, setPeriodTo] = useState(() => getPresetDates('current_month').to);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [slaHistory, setSlaHistory] = useState<SlaPoint[]>([]);
  const [slaCurrent, setSlaCurrent] = useState<SlaCurrent | null>(null);
  const [loadingSla, setLoadingSla] = useState(true);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingSlaPdf, setLoadingSlaPdf] = useState(false);
  const [loadingCsv, setLoadingCsv] = useState(false);
  const [error, setError] = useState('');
  const [showPresets, setShowPresets] = useState(false);

  // Load tenants for SOC users
  useEffect(() => {
    if (!isSoc) return;
    api.get('/soc/tenants')
      .then(({ data }) => {
        setTenants(data || []);
        if (data && data.length > 0) setSelectedTenant(data[0].id);
      })
      .catch(() => {});
  }, [isSoc]);

  // Apply preset
  function applyPreset(p: string) {
    setPreset(p);
    setShowPresets(false);
    if (p !== 'custom') {
      const dates = getPresetDates(p);
      setPeriodFrom(dates.from);
      setPeriodTo(dates.to);
    }
  }

  // Load SLA data
  useEffect(() => {
    if (!periodFrom) return;
    if (isSoc && !selectedTenant) {
      setLoadingSla(false);
      return;
    }
    setLoadingSla(true);
    const tp = isSoc && selectedTenant ? `&tenant_id=${selectedTenant}` : '';
    Promise.all([
      api.get(`/dashboard/sla-history?period=90d${tp}`),
      api.get(`/dashboard/sla?period=30d${tp}`),
    ])
      .then(([hist, cur]) => {
        setSlaHistory(Array.isArray(hist.data) ? hist.data : []);
        setSlaCurrent(cur.data || null);
      })
      .catch(() => {})
      .finally(() => setLoadingSla(false));
  }, [periodFrom, selectedTenant, isSoc]);

  const tid = isSoc && selectedTenant ? selectedTenant : undefined;

  async function downloadMonthlyPdf() {
    setLoadingPdf(true);
    setError('');
    try {
      const resp = await api.get('/reports/monthly', {
        params: { period_from: periodFrom, period_to: periodTo, tenant_id: tid },
        responseType: 'blob',
      });
      downloadBlob(resp.data, `soc_report_${periodFrom}_${periodTo}.pdf`);
    } catch (err) {
      setError(await extractError(err));
    } finally {
      setLoadingPdf(false);
    }
  }

  async function downloadSlaPdf() {
    setLoadingSlaPdf(true);
    setError('');
    try {
      const resp = await api.get('/reports/sla-pdf', {
        params: { period_from: periodFrom, period_to: periodTo, tenant_id: tid },
        responseType: 'blob',
      });
      downloadBlob(resp.data, `sla_report_${periodFrom}_${periodTo}.pdf`);
    } catch (err) {
      setError(await extractError(err));
    } finally {
      setLoadingSlaPdf(false);
    }
  }

  async function downloadCsv() {
    setLoadingCsv(true);
    setError('');
    try {
      const resp = await api.get('/reports/csv', {
        params: { period_from: periodFrom, period_to: periodTo, tenant_id: tid },
        responseType: 'blob',
      });
      downloadBlob(resp.data, `incidents_${periodFrom}_${periodTo}.csv`);
    } catch (err) {
      setError(await extractError(err));
    } finally {
      setLoadingCsv(false);
    }
  }

  const compColor = slaCurrent?.compliance_pct != null
    ? (slaCurrent.compliance_pct >= 95 ? 'text-emerald-400' : slaCurrent.compliance_pct >= 80 ? 'text-amber-400' : 'text-red-400')
    : 'text-surface-500';

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-surface-100">Отчёты</h1>
        <p className="text-sm text-surface-500 mt-1">SLA-метрики и экспорт данных</p>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Period + Tenant selector */}
      <div className="card p-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Tenant selector for SOC */}
          {isSoc && (
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-surface-500" />
              <select
                value={selectedTenant}
                onChange={(e) => setSelectedTenant(e.target.value)}
                className="input text-sm"
                style={{ width: 220 }}
              >
                <option value="">Выберите клиента</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Period presets */}
          <div className="relative">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 hover:border-surface-600"
            >
              <Calendar className="w-4 h-4 text-surface-500" />
              {PERIOD_PRESETS.find(p => p.value === preset)?.label || 'Период'}
              <ChevronDown className="w-3 h-3 text-surface-500" />
            </button>
            {showPresets && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-20 py-1">
                {PERIOD_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => applyPreset(p.value)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-surface-700 ${preset === p.value ? 'text-brand-400' : 'text-surface-300'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date inputs */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={periodFrom}
              onChange={(e) => { setPeriodFrom(e.target.value); setPreset('custom'); }}
              className="input text-sm"
              style={{ width: 155 }}
            />
            <span className="text-surface-600">—</span>
            <input
              type="date"
              value={periodTo}
              onChange={(e) => { setPeriodTo(e.target.value); setPreset('custom'); }}
              className="input text-sm"
              style={{ width: 155 }}
            />
          </div>
        </div>
      </div>

      {/* SLA KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          icon={Clock}
          label="MTTA (ср. реакция)"
          value={loadingSla ? '...' : fmtMinutes(slaCurrent?.mtta_minutes)}
          accent="text-brand-400"
          sub="за 30 дней"
        />
        <KPICard
          icon={TrendingUp}
          label="MTTR (ср. решение)"
          value={loadingSla ? '...' : fmtMinutes(slaCurrent?.mttr_minutes)}
          accent="text-brand-400"
          sub="за 30 дней"
        />
        <KPICard
          icon={Shield}
          label="SLA Compliance"
          value={loadingSla ? '...' : slaCurrent?.compliance_pct != null ? `${slaCurrent.compliance_pct}%` : '—'}
          accent={compColor}
          sub="целевой: ≥ 95%"
        />
        <KPICard
          icon={Activity}
          label="Инцидентов"
          value={loadingSla ? '...' : (slaHistory.length > 0 ? String(slaHistory[slaHistory.length - 1]?.incidents_total ?? '—') : '—')}
          accent="text-surface-200"
          sub="закрыто за период"
        />
      </div>

      {/* SLA Trend Charts */}
      <div className="grid grid-cols-2 gap-4">
        {/* MTTA/MTTR */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-300 mb-4">Тренд MTTA / MTTR (минуты)</h2>
          <div className="h-56">
            {slaHistory.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slaHistory}>
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d27', border: '1px solid #394253', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#8593ab' }}
                    formatter={(v: number) => [`${v} мин`]}
                  />
                  <Line type="monotone" dataKey="mtta_minutes" stroke="#3b82f6" strokeWidth={2} dot={false} name="MTTA" connectNulls />
                  <Line type="monotone" dataKey="mttr_minutes" stroke="#f97316" strokeWidth={2} dot={false} name="MTTR" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-surface-600 text-sm">
                Недостаточно данных для графика
              </div>
            )}
          </div>
          <div className="flex items-center gap-6 mt-3 justify-center">
            <div className="flex items-center gap-2 text-xs text-surface-400">
              <span className="w-3 h-0.5 bg-blue-500 rounded" /> MTTA
            </div>
            <div className="flex items-center gap-2 text-xs text-surface-400">
              <span className="w-3 h-0.5 bg-orange-500 rounded" /> MTTR
            </div>
          </div>
        </div>

        {/* Compliance */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-300 mb-4">SLA Compliance (%)</h2>
          <div className="h-56">
            {slaHistory.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={slaHistory}>
                  <defs>
                    <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d27', border: '1px solid #394253', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v}%`]}
                  />
                  <Area type="monotone" dataKey="compliance_pct" stroke="#22c55e" strokeWidth={2} fill="url(#compGrad)" name="Compliance" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-surface-600 text-sm">
                Недостаточно данных для графика
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export Cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* SOC Report */}
        <ExportCard
          icon={<FileText className="w-5 h-5 text-red-400" />}
          iconBg="bg-red-500/10"
          title="Отчёт SOC"
          subtitle="PDF • Сводка инцидентов + SLA"
          description="Полный отчёт за период: статистика по приоритетам, статусам, метрики SLA."
          buttonText="Скачать PDF"
          loading={loadingPdf}
          onClick={downloadMonthlyPdf}
          primary
        />
        {/* SLA Report */}
        <ExportCard
          icon={<Shield className="w-5 h-5 text-emerald-400" />}
          iconBg="bg-emerald-500/10"
          title="Отчёт SLA"
          subtitle="PDF • MTTA/MTTR по приоритетам"
          description="Детальный SLA: метрики по приоритетам, compliance, целевые значения."
          buttonText="Скачать PDF"
          loading={loadingSlaPdf}
          onClick={downloadSlaPdf}
          primary
        />
        {/* CSV */}
        <ExportCard
          icon={<Download className="w-5 h-5 text-blue-400" />}
          iconBg="bg-blue-500/10"
          title="Экспорт CSV"
          subtitle="Таблица • Для Excel / аналитики"
          description="Все инциденты за период в CSV. ID, приоритет, статус, IP, рекомендации."
          buttonText="Скачать CSV"
          loading={loadingCsv}
          onClick={downloadCsv}
          primary={false}
        />
      </div>

      {/* Tip */}
      <div className="p-4 bg-brand-500/5 border border-brand-500/10 rounded-xl text-sm text-brand-300">
        <strong>Совет:</strong> PDF по отдельному инциденту можно скачать на странице детализации.
        SLA-метрики рассчитываются автоматически каждый час.
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function KPICard({ icon: Icon, label, value, accent, sub }: {
  icon: React.ElementType; label: string; value: string; accent: string; sub: string;
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

function ExportCard({ icon, iconBg, title, subtitle, description, buttonText, loading, onClick, primary }: {
  icon: React.ReactNode; iconBg: string; title: string; subtitle: string;
  description: string; buttonText: string; loading: boolean;
  onClick: () => void; primary: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-surface-200">{title}</h3>
          <p className="text-xs text-surface-500">{subtitle}</p>
        </div>
      </div>
      <p className="text-xs text-surface-500 mb-4">{description}</p>
      <button
        onClick={onClick}
        disabled={loading}
        className={`${primary ? 'btn-primary' : 'btn-secondary'} text-sm w-full flex items-center justify-center gap-2`}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {loading ? 'Загрузка...' : buttonText}
      </button>
    </div>
  );
}
