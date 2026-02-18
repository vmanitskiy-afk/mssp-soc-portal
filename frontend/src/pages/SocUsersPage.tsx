import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Shield, Users } from 'lucide-react';
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
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    role: 'client_admin',
    tenant_id: '',
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/soc/users');
      setUsers(data.items || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTenants = useCallback(async () => {
    try {
      const { data } = await api.get('/soc/tenants');
      setTenants(data.items || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchTenants();
  }, [fetchUsers, fetchTenants]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setCreating(true);

    try {
      const payload: Record<string, string> = {
        email: form.email,
        name: form.name,
        password: form.password,
        role: form.role,
      };
      if (form.tenant_id) payload.tenant_id = form.tenant_id;
      await api.post('/soc/users', payload);
      setSuccess(`Пользователь ${form.email} создан`);
      setForm({ email: '', name: '', password: '', role: 'client_admin', tenant_id: '' });
      setShowForm(false);
      fetchUsers();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { detail?: unknown } } })?.response?.data;
      let msg = 'Ошибка создания';
      if (resp?.detail) {
        if (typeof resp.detail === 'string') {
          msg = resp.detail;
        } else if (Array.isArray(resp.detail)) {
          msg = resp.detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join('; ');
        } else {
          msg = JSON.stringify(resp.detail);
        }
      }
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (userId: string, userName: string) => {
    if (!window.confirm(`Деактивировать пользователя ${userName}?`)) return;
    try {
      await api.delete(`/soc/users/${userId}`);
      fetchUsers();
    } catch {
      /* ignore */
    }
  };

  const isClientRole = form.role.startsWith('client_');

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', margin: 0 }}>
            Управление пользователями
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: 4 }}>
            {users.length} пользователей
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setError(''); setSuccess(''); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0.625rem 1.25rem',
            background: '#3b82f6', color: '#fff', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
          }}
        >
          <Plus size={18} />
          Создать пользователя
        </button>
      </div>

      {/* Success message */}
      {success && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 8, color: '#22c55e', fontSize: '0.875rem',
        }}>
          ✓ {success}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div style={{
          background: '#1e293b', border: '1px solid #334155',
          borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#fff', marginTop: 0, marginBottom: '1rem' }}>
            Новый пользователь
          </h2>

          {error && (
            <div style={{
              padding: '0.75rem 1rem', marginBottom: '1rem',
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8, color: '#ef4444', fontSize: '0.875rem',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Name */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 4 }}>
                  Имя *
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Иван Иванов"
                  style={{
                    width: '100%', padding: '0.625rem 0.75rem',
                    background: '#0f172a', border: '1px solid #334155',
                    borderRadius: 8, color: '#fff', fontSize: '0.875rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Email */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 4 }}>
                  Email *
                </label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="user@company.com"
                  style={{
                    width: '100%', padding: '0.625rem 0.75rem',
                    background: '#0f172a', border: '1px solid #334155',
                    borderRadius: 8, color: '#fff', fontSize: '0.875rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Password */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 4 }}>
                  Пароль *
                </label>
                <input
                  required
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Минимум 12 символов"
                  minLength={12}
                  style={{
                    width: '100%', padding: '0.625rem 0.75rem',
                    background: '#0f172a', border: '1px solid #334155',
                    borderRadius: 8, color: '#fff', fontSize: '0.875rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Role */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 4 }}>
                  Роль *
                </label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  style={{
                    width: '100%', padding: '0.625rem 0.75rem',
                    background: '#0f172a', border: '1px solid #334155',
                    borderRadius: 8, color: '#fff', fontSize: '0.875rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Tenant (for client roles) */}
              {isClientRole && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 4 }}>
                    Клиент (tenant) *
                  </label>
                  <select
                    required
                    value={form.tenant_id}
                    onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
                    style={{
                      width: '100%', padding: '0.625rem 0.75rem',
                      background: '#0f172a', border: '1px solid #334155',
                      borderRadius: 8, color: '#fff', fontSize: '0.875rem',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  >
                    <option value="">Выберите клиента</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.short_name})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="submit"
                disabled={creating}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '0.625rem 1.25rem',
                  background: creating ? '#475569' : '#3b82f6',
                  color: '#fff', border: 'none',
                  borderRadius: 8, cursor: creating ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '0.875rem',
                }}
              >
                {creating ? 'Создание...' : 'Создать'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{
                  padding: '0.625rem 1.25rem',
                  background: 'transparent', color: '#94a3b8',
                  border: '1px solid #334155',
                  borderRadius: 8, cursor: 'pointer', fontSize: '0.875rem',
                }}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div style={{
        background: '#1e293b', border: '1px solid #334155',
        borderRadius: 12, overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
            Загрузка...
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
            <Users size={40} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <p>Пользователей пока нет</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Пользователь', 'Роль', 'Клиент', 'MFA', 'Последний вход', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '0.75rem 1rem', textAlign: 'left',
                      color: '#64748b', fontSize: '0.75rem', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  style={{ borderBottom: '1px solid #1e293b' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#1e293b80')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* User info */}
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ color: '#f1f5f9', fontWeight: 500, fontSize: '0.875rem' }}>
                      {u.name}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{u.email}</div>
                  </td>

                  {/* Role */}
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '2px 10px', borderRadius: 20,
                      background: `${getRoleColor(u.role)}22`,
                      color: getRoleColor(u.role),
                      fontSize: '0.8rem', fontWeight: 500,
                    }}>
                      <Shield size={12} />
                      {getRoleLabel(u.role)}
                    </span>
                  </td>

                  {/* Tenant */}
                  <td style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                    {u.tenant_id ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        ■
                        {tenants.find((t) => t.id === u.tenant_id)?.name || u.tenant_id.slice(0, 8)}
                      </span>
                    ) : (
                      <span style={{ color: '#475569' }}>—</span>
                    )}
                  </td>

                  {/* MFA */}
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      color: u.mfa_enabled ? '#22c55e' : '#475569',
                      fontSize: '0.8rem',
                    }}>
                      🔑
                      {u.mfa_enabled ? 'Вкл' : 'Выкл'}
                    </span>
                  </td>

                  {/* Last login */}
                  <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.8rem' }}>
                    {u.last_login
                      ? new Date(u.last_login).toLocaleString('ru-RU')
                      : 'Никогда'}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    <button
                      onClick={() => handleDeactivate(u.id, u.name)}
                      title="Деактивировать"
                      style={{
                        background: 'transparent', border: 'none',
                        color: '#64748b', cursor: 'pointer', padding: 4,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
