import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2, Plus, Pencil, Trash2, Power, Server, Users,
  X, Loader2, Mail, Phone, Check, ChevronDown, ChevronRight,
} from 'lucide-react';
import api from '../services/api';
import { timeAgo } from '../utils';

interface TenantItem {
  id: string;
  name: string;
  short_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  sources_count: number;
  users_count: number;
  created_at: string | null;
}

interface SourceItem {
  id: string;
  name: string;
  host: string;
  source_type: string;
  status: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  client_admin: 'Админ',
  client_security: 'Безопасник',
  client_auditor: 'Аудитор',
  client_readonly: 'Только чтение',
};

const emptyForm = { name: '', short_name: '', contact_email: '', contact_phone: '' };

export default function SocTenantsPage() {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Expanded tenant (sources & users)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [tenantUsers, setTenantUsers] = useState<UserItem[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const fetchTenants = useCallback(async () => {
    try {
      const { data } = await api.get('/soc/tenants', { params: { include_inactive: showInactive } });
      setTenants(data.items || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [showInactive]);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  const fetchTenantDetails = async (tenantId: string) => {
    setLoadingSources(true);
    try {
      const [srcRes, usrRes] = await Promise.all([
        api.get(`/soc/tenants/${tenantId}/sources`),
        api.get(`/soc/tenants/${tenantId}/users`),
      ]);
      setSources(srcRes.data.items || []);
      setTenantUsers(usrRes.data.items || []);
    } catch { /* */ }
    finally { setLoadingSources(false); }
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setSources([]);
      setTenantUsers([]);
    } else {
      setExpandedId(id);
      fetchTenantDetails(id);
    }
  };

  // Create
  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setError('');
    setShowModal(true);
  };

  // Edit
  const openEdit = (t: TenantItem) => {
    setForm({
      name: t.name,
      short_name: t.short_name,
      contact_email: t.contact_email || '',
      contact_phone: t.contact_phone || '',
    });
    setEditingId(t.id);
    setError('');
    setShowModal(true);
  };

  // Save
  const handleSave = async () => {
    if (!form.name.trim() || !form.short_name.trim()) {
      setError('Заполните название и код клиента');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.put(`/soc/tenants/${editingId}`, form);
      } else {
        await api.post('/soc/tenants', form);
      }
      setShowModal(false);
      await fetchTenants();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err.response?.data?.detail || 'Ошибка сохранения');
    } finally { setSaving(false); }
  };

  // Toggle active
  const handleToggle = async (id: string) => {
    try {
      await api.put(`/soc/tenants/${id}/toggle`);
      await fetchTenants();
    } catch { /* */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">Управление клиентами</h1>
          <p className="text-sm text-surface-500 mt-1">{tenants.length} клиент{tenants.length === 1 ? '' : tenants.length < 5 ? 'а' : 'ов'}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-surface-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded border-surface-600"
            />
            Показать неактивных
          </label>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" />
            Добавить клиента
          </button>
        </div>
      </div>

      {/* Tenant cards */}
      <div className="space-y-3">
        {tenants.length === 0 ? (
          <div className="card p-12 text-center">
            <Building2 className="w-10 h-10 text-surface-600 mx-auto mb-3" />
            <p className="text-surface-500">Клиенты не найдены</p>
          </div>
        ) : tenants.map(t => (
          <div key={t.id} className={`card transition-all ${!t.is_active ? 'opacity-50' : ''}`}>
            {/* Main row */}
            <div className="p-4 flex items-center gap-4">
              <button
                onClick={() => toggleExpand(t.id)}
                className="text-surface-500 hover:text-surface-300 transition-colors"
              >
                {expandedId === t.id
                  ? <ChevronDown className="w-4 h-4" />
                  : <ChevronRight className="w-4 h-4" />}
              </button>

              <div className="w-10 h-10 rounded-lg bg-brand-600/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-brand-400" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-surface-100 truncate">{t.name}</h3>
                  <span className="text-xs font-mono text-surface-500 bg-surface-800 px-1.5 py-0.5 rounded">{t.short_name}</span>
                  {!t.is_active && (
                    <span className="text-[10px] font-semibold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded uppercase">Неактивен</span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1">
                  {t.contact_email && (
                    <span className="text-xs text-surface-500 flex items-center gap-1">
                      <Mail className="w-3 h-3" />{t.contact_email}
                    </span>
                  )}
                  {t.contact_phone && (
                    <span className="text-xs text-surface-500 flex items-center gap-1">
                      <Phone className="w-3 h-3" />{t.contact_phone}
                    </span>
                  )}
                  {t.created_at && (
                    <span className="text-xs text-surface-600">Создан {timeAgo(t.created_at)}</span>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-5 text-xs text-surface-400 shrink-0">
                <div className="text-center">
                  <p className="text-lg font-semibold text-surface-200">{t.sources_count}</p>
                  <p className="text-surface-600">источник.</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-surface-200">{t.users_count}</p>
                  <p className="text-surface-600">пользов.</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(t)} className="p-2 rounded-lg hover:bg-surface-800 text-surface-500 hover:text-surface-300 transition-colors" title="Редактировать">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleToggle(t.id)} className="p-2 rounded-lg hover:bg-surface-800 text-surface-500 hover:text-surface-300 transition-colors" title={t.is_active ? 'Деактивировать' : 'Активировать'}>
                  <Power className={`w-4 h-4 ${t.is_active ? '' : 'text-emerald-400'}`} />
                </button>
              </div>
            </div>

            {/* Expanded: sources & users */}
            {expandedId === t.id && (
              <div className="border-t border-surface-800 p-4">
                {loadingSources ? (
                  <div className="flex items-center gap-2 text-xs text-surface-500 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Загрузка...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-6">
                    {/* Sources */}
                    <div>
                      <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Server className="w-3.5 h-3.5" />
                        Источники ({sources.length})
                      </h4>
                      {sources.length === 0 ? (
                        <p className="text-xs text-surface-600 py-2">Нет источников. Добавьте на странице «Источники».</p>
                      ) : (
                        <div className="space-y-1.5">
                          {sources.map(s => (
                            <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50 text-xs">
                              <StatusDot status={s.status} />
                              <span className="font-medium text-surface-300 truncate">{s.name}</span>
                              <span className="text-surface-600 font-mono ml-auto">{s.host}</span>
                              <span className="text-surface-600">{s.source_type}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Users */}
                    <div>
                      <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Users className="w-3.5 h-3.5" />
                        Пользователи ({tenantUsers.length})
                      </h4>
                      {tenantUsers.length === 0 ? (
                        <p className="text-xs text-surface-600 py-2">Нет пользователей. Добавьте на странице «Пользователи».</p>
                      ) : (
                        <div className="space-y-1.5">
                          {tenantUsers.map(u => (
                            <div key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50 text-xs ${!u.is_active ? 'opacity-50' : ''}`}>
                              <div className={`w-2 h-2 rounded-full shrink-0 ${u.is_active ? 'bg-emerald-400' : 'bg-surface-600'}`} />
                              <span className="font-medium text-surface-300 truncate">{u.name}</span>
                              <span className="text-surface-600 truncate">{u.email}</span>
                              <span className="text-surface-500 ml-auto">{ROLE_LABELS[u.role] || u.role}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create/Edit Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="card w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-surface-100">
                {editingId ? 'Редактировать клиента' : 'Новый клиент'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-surface-500 hover:text-surface-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-surface-400 mb-1.5 block">Название *</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="ООО Компания"
                  className="input"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-400 mb-1.5 block">Код (short_name) *</label>
                <input
                  value={form.short_name}
                  onChange={e => setForm({ ...form, short_name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                  placeholder="company"
                  className="input font-mono"
                  disabled={!!editingId}
                />
                {!editingId && (
                  <p className="text-[11px] text-surface-600 mt-1">Латиница, цифры, дефис. Нельзя изменить после создания.</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-surface-400 mb-1.5 block">Email контакта</label>
                <input
                  value={form.contact_email}
                  onChange={e => setForm({ ...form, contact_email: e.target.value })}
                  placeholder="security@company.ru"
                  className="input"
                  type="email"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-400 mb-1.5 block">Телефон контакта</label>
                <input
                  value={form.contact_phone}
                  onChange={e => setForm({ ...form, contact_phone: e.target.value })}
                  placeholder="+7 (999) 123-45-67"
                  className="input"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">Отмена</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editingId ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-400',
    degraded: 'bg-amber-400',
    no_logs: 'bg-red-400',
    error: 'bg-red-500',
    unknown: 'bg-surface-500',
  };
  return <div className={`w-2 h-2 rounded-full shrink-0 ${colors[status] || colors.unknown}`} />;
}
