import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  FileText, Download, Calendar, Loader2, TrendingUp, Clock,
  Shield, BarChart3, FileSpreadsheet, ChevronDown, Users,
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
      return { from: fmt(new Date(y, m, 1)), to: fmt(today) };
    case 'last_month':
      return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) };
    case '90d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 90);
      return { from: fmt(d), to: fmt(today) };
    }
    case 'current_quarter': {
      const qStart = new Date(y, Math.floor(m / 3) * 3, 1);
      return { from: fmt(qStart), to: fmt(today) };
    }
    default:
      return { from: fmt(new Date(y, m, 1)), to: fmt(today) };
  }
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatMinutes(min: number | null): string {
  if (min === null || min === undefined) return '\u2014';
  if (min < 60) return `${Math.round(min)} \u043c\u0438\u043d`;
  if (min < 1440) return `${(min / 60).toFixed(1)} \u0447`;
  return `${(min / 1440).toFixed(1)} \u0434\u043d`;
}

export default function ReportsPage() {
  const { user } = useAuthStore();
  const isSoc = user?.role?.startsWith('soc_');

  const [preset, setPreset] = useState('current_month');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
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
    if (isSoc) {
      api.get('/soc/tenants').then(({ data }) => {
        setTenants(data);
        if (data.length > 0) setSelectedTenant(data[0].id);
      }).catch(() => {});
    }
  }, [isSoc]);

  useEffect(() => {
    const dates = getPresetDates('current_month');
    setPeriodFrom(dates.from);
    setPeriodTo(dates.to);
  }, []);

  function applyPreset(p: string) {
    setPreset(p);
    setShowPresets(false);
    if (p !== 'custom') {
      const dates = getPresetDates(p);
      setPeriodFrom(dates.from);
      setPeriodTo(dates.to);
    }
  }

  useEffect(() => {
    if (!periodFrom) return;
    if (isSoc && !selectedTenant) { setLoadingSla(false); return; }
    setLoadingSla(true);
    const tenantParam = isSoc && selectedTenant ? `&tenant_id=${selectedTenant}` : '';
    Promise.all([
      api.get(`/dashboard/sla-history?period=90d${tenantParam}`),
      api.get(`/dashboard/sla?period=30d${tenantParam}`),
    ])
      .then(([hist, cur]) => {
        setSlaHistory(hist.data);
        setSlaCurrent(cur.data);
      })
      .catch(() => {})
      .finally(() => setLoadingSla(false));
  }, [periodFrom, selectedTenant, isSoc]);

  const tenantParam = isSoc && selectedTenant ? selectedTenant : undefined;

  async function downloadMonthlyPdf() {
    setLoadingPdf(true);
    setError('');
    try {
      const resp = await api.get('/reports/monthly', {
        params: { period_from: periodFrom, period_to: periodTo, tenant_id: tenantParam },
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
        params: { period_from: periodFrom, period_to: periodTo, tenant_id: tenantParam },
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
        params: { period_from: periodFrom, period_to: periodTo, tenant_id: tenantParam },
        responseType: 'blob',
      });
      downloadBlob(resp.data, `incidents_${periodFrom}_${periodTo}.csv`);
    } catch (err) {
      setError(await extractError(err));
    } finally {
      setLoadingCsv(false);
    }
  }

  const complianceColor = slaCurrent?.compliance_pct
    ? slaCurrent.compliance_pct >= 95 ? 'text-emerald-400' : slaCurrent.compliance_pct >= 80 ? 'text-amber-400' : 'text-red-400'
    : 'text-surface-500';

  return (
    <div className="space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold text-surface-100">{'\u041E\u0442\u0447\u0451\u0442\u044B'}</h1>
        <p className="text-sm text-surface-500 mt-1">SLA-{'\u043C\u0435\u0442\u0440\u0438\u043A\u0438'} {'\u0438'} {'\u044D\u043A\u0441\u043F\u043E\u0440\u0442'} {'\u0434\u0430\u043D\u043D\u044B\u0445'}</p>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Period selector */}
      <div className="card p-4">
        <div className="flex items-center gap-4 flex-wrap">
          {isSoc && (
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-surface-500" />
              <select
                value={selectedTenant}
                onChange={(e) => setSelectedTenant(e.target.value)}
                className="input text-sm w-56"
              >
                <option value="">{'\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430'}</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 hover:border-surface-600"
            >
              <Calendar className="w-4 h-4 text-surface-500" />
              {PERIOD_PRESETS.find(p => p.value === preset)?.label || '\u041F\u0435\u0440\u0438\u043E\u0434'}
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

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={periodFrom}
              onChange={(e) => { setPeriodFrom(e.target.value); setPreset('custom'); }}
              className="input text-sm w-40"
            />
            <span className="text-surface-600">{'\u2014'}</span>
            <input
              type="date"
              value={periodTo}
              onChange={(e) => { setPeriodTo(e.target.value); setPreset('custom'); }}
              className="input text-sm w-40"
            />
          </div>
        </div>
      </div>

      {/* SLA KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-surface-500" />
            <span className="text-xs font-medium text-surface-500">MTTA ({'\u0441\u0440. \u0440\u0435\u0430\u043A\u0446\u0438\u044F'})</span>
          </div>
          <p className="text-2xl font-semibold font-mono text-brand-400">
            {loadingSla ? '...' : formatMinutes(slaCurrent?.mtta_minutes ?? null)}
          </p>
          <p className="text-xs text-surface-600 mt-1">{'\u0437\u0430'} 30 {'\u0434\u043D\u0435\u0439'}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-surface-500" />
            <span className="text-xs font-medium text-surface-500">MTTR ({'\u0441\u0440. \u0440\u0435\u0448\u0435\u043D\u0438\u0435'})</span>
          </div>
          <p className="text-2xl font-semibold font-mono text-brand-400">
            {loadingSla ? '...' : formatMinutes(slaCurrent?.mttr_minutes ?? null)}
          </p>
          <p className="text-xs text-surface-600 mt-1">{'\u0437\u0430'} 30 {'\u0434\u043D\u0435\u0439'}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-surface-500" />
            <span className="text-xs font-medium text-surface-500">SLA Compliance</span>
          </div>
          <p className={`text-2xl font-semibold font-mono ${complianceColor}`}>
            {loadingSla ? '...' : slaCurrent?.compliance_pct != null ? `${slaCurrent.compliance_pct}%` : '\u2014'}
          </p>
          <p className="text-xs text-surface-600 mt-1">{'\u0446\u0435\u043B\u0435\u0432\u043E\u0439: \u2265 95%'}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-surface-500" />
            <span className="text-xs font-medium text-surface-500">{'\u0418\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u043E\u0432'}</span>
          </div>
          <p className="text-2xl font-semibold font-mono text-surface-200">
            {loadingSla ? '...' : slaHistory.length > 0
              ? slaHistory[slaHistory.length - 1]?.incidents_total || '\u2014'
              : '\u2014'}
          </p>
          <p className="text-xs text-surface-600 mt-1">{'\u0437\u0430\u043A\u0440\u044B\u0442\u043E \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434'}</p>
        </div>
      </div>

      {/* SLA Trend Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-300 mb-4">{'\u0422\u0440\u0435\u043D\u0434'} MTTA / MTTR ({'\u043C\u0438\u043D\u0443\u0442\u044B'})</h2>
          <div className="h-56">
            {slaHistory.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slaHistory}>
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#657591', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d27', border: '1px solid #394253', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: '#8593ab' }}
                    formatter={(value: number) => [`${value} \u043C\u0438\u043D`]}
                  />
                  <Line type="monotone" dataKey="mtta_minutes" stroke="#3b82f6" strokeWidth={2} dot={false} name="MTTA" connectNulls />
                  <Line type="monotone" dataKey="mttr_minutes" stroke="#f97316" strokeWidth={2} dot={false} name="MTTR" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-surface-600 text-sm">
                {'\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0434\u0430\u043D\u043D\u044B\u0445 \u0434\u043B\u044F \u0433\u0440\u0430\u0444\u0438\u043A\u0430'}
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
                    contentStyle={{ background: '#1a1d27', border: '1px solid #394253', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(value: number) => [`${value}%`]}
                  />
                  <Area type="monotone" dataKey="compliance_pct" stroke="#22c55e" strokeWidth={2} fill="url(#compGrad)" name="Compliance" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-surface-600 text-sm">
                {'\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0434\u0430\u043D\u043D\u044B\u0445 \u0434\u043B\u044F \u0433\u0440\u0430\u0444\u0438\u043A\u0430'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-surface-200">{'\u041E\u0442\u0447\u0451\u0442 SOC'}</h3>
              <p className="text-xs text-surface-500">PDF {'\u2022 \u0421\u0432\u043E\u0434\u043A\u0430 \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u043E\u0432 + SLA'}</p>
            </div>
          </div>
          <p className="text-xs text-surface-500 mb-4">
            {'\u041F\u043E\u043B\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442 \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434: \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u043F\u043E \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u0430\u043C, \u0441\u0442\u0430\u0442\u0443\u0441\u0430\u043C, \u043C\u0435\u0442\u0440\u0438\u043A\u0438 SLA.'}
          </p>
          <button onClick={downloadMonthlyPdf} disabled={loadingPdf} className="btn-primary text-sm w-full flex items-center justify-center gap-2">
            {loadingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {loadingPdf ? '\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F...' : '\u0421\u043A\u0430\u0447\u0430\u0442\u044C PDF'}
          </button>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-surface-200">{'\u041E\u0442\u0447\u0451\u0442 SLA'}</h3>
              <p className="text-xs text-surface-500">PDF {'\u2022'} MTTA/MTTR {'\u043F\u043E \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u0430\u043C'}</p>
            </div>
          </div>
          <p className="text-xs text-surface-500 mb-4">
            {'\u0414\u0435\u0442\u0430\u043B\u044C\u043D\u044B\u0439 SLA: \u043C\u0435\u0442\u0440\u0438\u043A\u0438 \u043F\u043E \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u0430\u043C, compliance, \u0446\u0435\u043B\u0435\u0432\u044B\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F.'}
          </p>
          <button onClick={downloadSlaPdf} disabled={loadingSlaPdf} className="btn-primary text-sm w-full flex items-center justify-center gap-2">
            {loadingSlaPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {loadingSlaPdf ? '\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F...' : '\u0421\u043A\u0430\u0447\u0430\u0442\u044C PDF'}
          </button>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-surface-200">{'\u042D\u043A\u0441\u043F\u043E\u0440\u0442 CSV'}</h3>
              <p className="text-xs text-surface-500">{'\u0422\u0430\u0431\u043B\u0438\u0446\u0430 \u2022 \u0414\u043B\u044F Excel / \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438'}</p>
            </div>
          </div>
          <p className="text-xs text-surface-500 mb-4">
            {'\u0412\u0441\u0435 \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u044B \u0437\u0430 \u043F\u0435\u0440\u0438\u043E\u0434 \u0432 CSV. ID, \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442, \u0441\u0442\u0430\u0442\u0443\u0441, IP, \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438.'}
          </p>
          <button onClick={downloadCsv} disabled={loadingCsv} className="btn-secondary text-sm w-full flex items-center justify-center gap-2">
            {loadingCsv ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {loadingCsv ? '\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0430...' : '\u0421\u043A\u0430\u0447\u0430\u0442\u044C CSV'}
          </button>
        </div>
      </div>

      <div className="p-4 bg-brand-500/5 border border-brand-500/10 rounded-xl text-sm text-brand-300">
        <strong>{'\u0421\u043E\u0432\u0435\u0442:'}</strong> PDF {'\u043F\u043E \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u043C\u0443 \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0441\u043A\u0430\u0447\u0430\u0442\u044C \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u0434\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438.'} SLA-{'\u043C\u0435\u0442\u0440\u0438\u043A\u0438 \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043A\u0430\u0436\u0434\u044B\u0439 \u0447\u0430\u0441.'}
      </div>
    </div>
  );
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
  const resp = (err as { response?: { data?: Blob } })?.response?.data;
  if (resp instanceof Blob) {
    try {
      const text = await resp.text();
      const json = JSON.parse(text);
      return json.detail || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u043E\u0442\u0447\u0451\u0442\u0430';
    } catch {
      return '\u041E\u0448\u0438\u0431\u043A\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u043E\u0442\u0447\u0451\u0442\u0430';
    }
  }
  return '\u041E\u0448\u0438\u0431\u043A\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u043E\u0442\u0447\u0451\u0442\u0430';
}
