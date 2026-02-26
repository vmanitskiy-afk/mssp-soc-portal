import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Shield, Users, Pencil, KeyRound, Check, X, Loader2 } from 'lucide-react';
import api from '../services/api';
import type { Tenant } from '../types';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string | null;
  mfa_enabled: boolean;
  is_active: boolean;
  last_login: string | null;
  created_at: string | null;
}

const ROLES = [
  { value: 'soc_admin', label: 'SOC Администратор', color: '#e74c3c' },
  { value: 'soc_analyst', label: 'SOC Аналитик', color: '#f39c12' },
  { value: 'client_admin', label: 'Клиент Админ', color: '#3498db' },
  { value: 'client_security', label: 'Клиент Безопасник', color: '#2ecc71' },
  { value: 'client_auditor', label: 'Клиент Аудитор', color: '#9b59b6' },
  { value: 'client_readonly', label: 'Клиент (только чтение)', color: '#95a5a6' },
];

function getRoleLabel(role: string) {
  return ROLES.find((r) => r.value === role)?.label || role;
}
function getRoleColor(role: string) {
  return ROLES.find((r) => r.value === role)?.color || '#95a5a6';
}

export default function SocUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [resetUser, setResetUser] = useState<UserItem | null>(null);

  // Create form
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'client_admin', tenant_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Edit form
  const [editForm, setEditForm] = useState({ name: '', role: '', tenant_id: '' });

  // Reset password form
  const [newPassword, setNewPassword] = useState('');

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/soc/users');
      setUsers(data.items || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  const fetchTenants = useCallback(async () => {
    try {
      const { data } = await api.get('/soc/tenants');
      setTenants(data.items || []);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchUsers(); fetchTenants(); }, [fetchUsers, fetchTenants]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const payload: Record<string, string> = { email: form.email, name: form.name, password: form.password, role: form.role };
      if (form.tenant_id) payload.tenant_id = form.tenant_id;
      await api.post('/soc/users', payload);
      setSuccess(`Пользователь ${form.email} создан`);
      setForm({ email: '', name: '', password: '', role: 'client_admin', tenant_id: '' });
      setShowCreate(false);
      fetchUsers();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally { setSaving(false); }
  };

  const handleDeactivate = async (u: UserItem) => {
    if (!window.confirm(`Деактивировать пользователя ${u.name}?`)) return;
    try {
      await api.delete(`/soc/users/${u.id}`);
      fetchUsers();
    } catch { /* */ }
  };

  const handleActivate = async (u: UserItem) => {
    try {
      await api.put(`/soc/users/${u.id}`, { is_active: true });
      fetchUsers();
    } catch { /* */ }
  };

  const openEdit = (u: UserItem) => {
    setEditUser(u);
    setEditForm({ name: u.name, role: u.role, tenant_id: u.tenant_id || '' });
    setError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setError(''); setSaving(true);
    try {
      await api.put(`/soc/users/${editUser.id}`, {
        name: editForm.name,
        role: editForm.role,
        tenant_id: editForm.tenant_id || null,
      });
      setEditUser(null);
      setSuccess(`Пользователь ${editForm.name} обновлён`);
      fetchUsers();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally { setSaving(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser) return;
    setError(''); setSaving(true);
    try {
      await api.post(`/soc/users/${resetUser.id}/reset-password`, { new_password: newPassword });
      setResetUser(null);
      setNewPassword('');
      setSuccess(`Пароль для ${resetUser.name} сброшен. MFA отключён.`);
    } catch (err: unknown) {
      setError(extractError(err));
    } finally { setSaving(false); }
  };

  const isClientRole = (r: string) => r.startsWith('client_');

  return (
    <div className="space-y-6 animate-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">Управление пользователями</h1>
          <p className="text-sm text-surface-500 mt-1">{users.length} пользователей</p>
        </div>
        <button onClick={() => { setShowCreate(!showCreate); setError(''); setSuccess(''); }} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Создать пользователя
        </button>
      </div>

      {/* Success */}
      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400 flex items-center justify-between">
          <span>✓ {success}</span>
          <button onClick={() => setSuccess('')} className="text-emerald-500 hover:text-emerald-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="card p-5">
          <h2 className="text-base font-semibold text-surface-200 mb-4">Новый пользователь</h2>
          {error && !editUser && !resetUser && <ErrorMsg text={error} />}
          <form onSubmit={handleCreate}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Имя *">
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Иван Иванов" className="input text-sm" />
              </Field>
              <Field label="Email *">
                <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@company.com" className="input text-sm" />
              </Field>
              <Field label="Пароль *">
                <input required type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Минимум 12 символов" minLength={12} className="input text-sm" />
              </Field>
              <Field label="Роль *">
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="input text-sm">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              {isClientRole(form.role) && (
                <Field label="Клиент *" span2>
                  <select required value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })} className="input text-sm">
                    <option value="">Выберите клиента</option>
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.short_name})</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {saving ? 'Создание...' : 'Создать'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Отмена</button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-surface-500"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Загрузка...</div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-surface-600">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>Пользователей пока нет</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700">
                {['Пользователь', 'Роль', 'Клиент', 'MFA', 'Статус', 'Последний вход', 'Действия'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-surface-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-surface-200">{u.name}</div>
                    <div className="text-xs text-surface-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                      style={{ background: `${getRoleColor(u.role)}22`, color: getRoleColor(u.role) }}>
                      <Shield className="w-3 h-3" />
                      {getRoleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-surface-400">
                    {u.tenant_id ? tenants.find(t => t.id === u.tenant_id)?.name || u.tenant_id.slice(0, 8) : <span className="text-surface-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={async () => {
                        try {
                          await api.put(`/soc/users/${u.id}/mfa`, { enabled: !u.mfa_enabled });
                          setUsers(prev => prev.map(x => x.id === u.id ? { ...x, mfa_enabled: !x.mfa_enabled } : x));
                        } catch { setError('Не удалось изменить MFA'); }
                      }}
                      className={`text-xs px-2 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity ${u.mfa_enabled ? 'text-emerald-400 bg-emerald-400/10' : 'text-surface-600 bg-surface-800'}`}
                      title={u.mfa_enabled ? 'Отключить MFA' : 'Включить MFA'}
                    >
                      {u.mfa_enabled ? '✓ Вкл' : 'Выкл'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">Активен</span>
                    ) : (
                      <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded">Неактивен</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-surface-500">
                    {u.last_login ? new Date(u.last_login).toLocaleString('ru-RU') : 'Никогда'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(u)} title="Редактировать" className="p-1.5 rounded hover:bg-surface-700 text-surface-500 hover:text-brand-400 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { setResetUser(u); setNewPassword(''); setError(''); }} title="Сбросить пароль" className="p-1.5 rounded hover:bg-surface-700 text-surface-500 hover:text-amber-400 transition-colors">
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      {u.is_active ? (
                        <button onClick={() => handleDeactivate(u)} title="Деактивировать" className="p-1.5 rounded hover:bg-surface-700 text-surface-500 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => handleActivate(u)} title="Активировать" className="p-1.5 rounded hover:bg-surface-700 text-surface-500 hover:text-emerald-400 transition-colors">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Modal */}
      {editUser && (
        <Modal title={`Редактировать: ${editUser.name}`} onClose={() => setEditUser(null)}>
          {error && <ErrorMsg text={error} />}
          <form onSubmit={handleEdit}>
            <div className="space-y-4">
              <Field label="Имя">
                <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="input text-sm" />
              </Field>
              <Field label="Email">
                <input disabled value={editUser.email} className="input text-sm opacity-60 cursor-not-allowed" />
              </Field>
              <Field label="Роль">
                <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="input text-sm">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              {isClientRole(editForm.role) && (
                <Field label="Клиент">
                  <select value={editForm.tenant_id} onChange={e => setEditForm({ ...editForm, tenant_id: e.target.value })} className="input text-sm">
                    <option value="">Без привязки</option>
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.short_name})</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Сохранить
              </button>
              <button type="button" onClick={() => setEditUser(null)} className="btn-secondary text-sm">Отмена</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <Modal title={`Сброс пароля: ${resetUser.name}`} onClose={() => setResetUser(null)}>
          {error && <ErrorMsg text={error} />}
          <p className="text-sm text-surface-400 mb-4">
            После сброса MFA будет отключён. Пользователю потребуется заново настроить двухфакторную аутентификацию.
          </p>
          <form onSubmit={handleResetPassword}>
            <Field label="Новый пароль">
              <input type="password" required minLength={12} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Минимум 12 символов" className="input text-sm" />
            </Field>
            <div className="flex gap-3 mt-5">
              <button type="submit" disabled={saving || newPassword.length < 12} className="btn-primary text-sm flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Сбросить пароль
              </button>
              <button type="button" onClick={() => setResetUser(null)} className="btn-secondary text-sm">Отмена</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function Field({ label, span2, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <label className="block text-xs text-surface-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ErrorMsg({ text }: { text: string }) {
  return (
    <div className="p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">{text}</div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pt-16">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-surface-200">{title}</h2>
          <button onClick={onClose} className="text-surface-500 hover:text-surface-300"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function extractError(err: unknown): string {
  const resp = (err as { response?: { data?: { detail?: unknown } } })?.response?.data;
  if (!resp?.detail) return 'Ошибка';
  if (typeof resp.detail === 'string') return resp.detail;
  if (Array.isArray(resp.detail)) return resp.detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join('; ');
  return JSON.stringify(resp.detail);
}
