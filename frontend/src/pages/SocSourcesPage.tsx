import { useEffect, useState } from 'react';
import {
  Server, Plus, Pencil, Trash2, RefreshCw, Search,
  CheckCircle, AlertTriangle, XCircle, HelpCircle,
  ChevronDown, X, Loader2, Zap,
} from 'lucide-react';
import api from '../services/api';
import { timeAgo } from '../utils';
import type { Tenant } from '../types';

interface SourceItem {
  id: string;
  name: string;
  source_type: string;
  host: string;
  vendor: string | null;
  product: string | null;
  rusiem_group_name: string | null;
  status: string;
  last_event_at: string | null;
  eps: number | null;
  tenant_id: string;
  created_at: string | null;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  active:   { icon: CheckCircle,   color: 'text-emerald-400', label: 'Активен' },
  degraded: { icon: AlertTriangle, color: 'text-amber-400',   label: 'Деградация' },
  no_logs:  { icon: XCircle,       color: 'text-red-400',     label: 'Нет логов' },
  error:    { icon: XCircle,       color: 'text-red-500',     label: 'Ошибка' },
  unknown:  { icon: HelpCircle,    color: 'text-surface-500', label: 'Неизвестен' },
};

const SOURCE_TYPES = [
  'Firewall', 'IDS/IPS', 'WAF', 'Endpoint', 'Server', 'Domain Controller',
  'Mail Server', 'Proxy', 'VPN', 'Switch/Router', 'Database', 'Application',
  'Cloud', 'Antivirus', 'DLP', 'Other',
];

const emptyForm = {
  tenant_id: '',
  name: '',
  source_type: '',
  host: '',
  vendor: '',
  product: '',
  rusiem_group_name: '',
};

export default function SocSourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Filters
  const [tenantFilter, setTenantFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Fetch tenants
  useEffect(() => {
    api.get('/soc/tenants').then(({ data }) => setTenants(data.items || [])).catch(() => {});
  }, []);

  // Fetch sources
  const fetchSources = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, per_page: 50 };
      if (tenantFilter) params.tenant_id = tenantFilter;
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;

      const { data } = await api.get('/soc/sources', { params });
      setSources(data.items || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, [tenantFilter, statusFilter, search, page]);

  // Sync sources
  const handleSync = async () => {
    setSyncing(true);
    try {
      const params = tenantFilter ? { tenant_id: tenantFilter } : {};
      await api.post('/soc/sources/sync', null, { params });
      await fetchSources();
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  };

  // Open add modal
  const openAdd = () => {
    setForm({ ...emptyForm, tenant_id: tenantFilter || '' });
    setEditingId(null);
    setError('');
    setShowModal(true);
  };

  // Open edit modal
  const openEdit = (s: SourceItem) => {
    setForm({
      tenant_id: s.tenant_id,
      name: s.name,
      source_type: s.source_type,
      host: s.host,
      vendor: s.vendor || '',
      product: s.product || '',
      rusiem_group_name: s.rusiem_group_name || '',
    });
    setEditingId(s.id);
    setError('');
    setShowModal(true);
  };

  // Save
  const handleSave = async () => {
    if (!form.tenant_id || !form.name || !form.source_type || !form.host) {
      setError('Заполните обязательные поля');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.put(`/soc/sources/${editingId}`, {
          name: form.name,
          source_type: form.source_type,
          host: form.host,
          vendor: form.vendor || null,
          product: form.product || null,
          rusiem_group_name: form.rusiem_group_name || null,
        });
      } else {
        await api.post('/soc/sources', {
          tenant_id: form.tenant_id,
          name: form.name,
          source_type: form.source_type,
          host: form.host,
          vendor: form.vendor || null,
          product: form.product || null,
          rusiem_group_name: form.rusiem_group_name || null,
        });
      }
      setShowModal(false);
      fetchSources();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Удалить источник «${name}»?`)) return;
    try {
      await api.delete(`/soc/sources/${id}`);
      fetchSources();
    } catch {
      // ignore
    }
  };

  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.short_name || id.slice(0, 8);

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">Управление источниками</h1>
          <p className="text-sm text-surface-500 mt-1">
            {total} источник{total % 10 === 1 && total !== 11 ? '' : total % 10 >= 2 && total % 10 <= 4 && (total < 10 || total > 20) ? 'а' : 'ов'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSync} disabled={syncing} className="btn-secondary flex items-center gap-2 text-sm">
            <Zap className={`w-4 h-4 ${syncing ? 'animate-pulse text-amber-400' : ''}`} />
            {syncing ? 'Синхронизация...' : 'Синхронизировать'}
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" />
            Добавить
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            placeholder="Поиск по имени или хосту..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-10"
          />
        </div>
        <select
          value={tenantFilter}
          onChange={(e) => { setTenantFilter(e.target.value); setPage(1); }}
          className="input w-48"
        >
          <option value="">Все клиенты</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="input w-40"
        >
          <option value="">Все статусы</option>
          {Object.entries(statusConfig).map(([v, { label }]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-surface-500 animate-spin" />
        </div>
      ) : sources.length === 0 ? (
        <div className="card p-16 text-center">
          <Server className="w-10 h-10 text-surface-700 mx-auto mb-3" />
          <p className="text-surface-400">Источники не найдены</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-800">
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">Статус</th>
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">Название</th>
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">Хост</th>
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">Тип</th>
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">Клиент</th>
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">Вендор</th>
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">Посл. событие</th>
                <th className="text-left text-xs font-medium text-surface-500 px-4 py-3">EPS</th>
                <th className="text-right text-xs font-medium text-surface-500 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const cfg = statusConfig[s.status] || statusConfig.unknown;
                const StatusIcon = cfg.icon;
                return (
                  <tr key={s.id} className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon className={`w-4 h-4 ${cfg.color}`} />
                        <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-surface-200 font-medium">{s.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-surface-400 font-mono">{s.host}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-surface-500 bg-surface-800 px-2 py-0.5 rounded">{s.source_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-surface-400">{tenantName(s.tenant_id)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-surface-500">{s.vendor || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-surface-500">{s.last_event_at ? timeAgo(s.last_event_at) : '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-surface-400 font-mono">{s.eps?.toFixed(1) || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(s)}
                          className="p-1.5 rounded hover:bg-surface-700 text-surface-500 hover:text-surface-300 transition-colors"
                          title="Редактировать"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id, s.name)}
                          className="p-1.5 rounded hover:bg-red-500/10 text-surface-500 hover:text-red-400 transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-surface-800">
              <span className="text-xs text-surface-500">
                Страница {page} из {pages} ({total} всего)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="btn-ghost text-xs px-3 py-1 disabled:opacity-30"
                >
                  Назад
                </button>
                <button
                  onClick={() => setPage(Math.min(pages, page + 1))}
                  disabled={page === pages}
                  className="btn-ghost text-xs px-3 py-1 disabled:opacity-30"
                >
                  Далее
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8">
          <div className="card w-full max-w-lg p-6 space-y-4 animate-in my-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-surface-100">
                {editingId ? 'Редактировать источник' : 'Добавить источник'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-surface-800 rounded">
                <X className="w-5 h-5 text-surface-400" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {!editingId && (
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Клиент *</label>
                  <select
                    value={form.tenant_id}
                    onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
                    className="input"
                  >
                    <option value="">Выберите клиента</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-surface-500 mb-1">Название *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Например: FortiGate HQ"
                  className="input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Тип источника *</label>
                  <select
                    value={form.source_type}
                    onChange={(e) => setForm({ ...form, source_type: e.target.value })}
                    className="input"
                  >
                    <option value="">Выберите тип</option>
                    {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Хост / IP *</label>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="10.1.1.1"
                    className="input font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Вендор</label>
                  <input
                    type="text"
                    value={form.vendor}
                    onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                    placeholder="Fortinet, Cisco..."
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Продукт</label>
                  <input
                    type="text"
                    value={form.product}
                    onChange={(e) => setForm({ ...form, product: e.target.value })}
                    placeholder="FortiGate, ASA..."
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-surface-500 mb-1">Группа источников в RuSIEM</label>
                <input
                  type="text"
                  value={form.rusiem_group_name}
                  onChange={(e) => setForm({ ...form, rusiem_group_name: e.target.value })}
                  placeholder="Имя группы в RuSIEM"
                  className="input"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">
                Отмена
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
