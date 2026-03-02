import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, RefreshCw, ExternalLink, ChevronLeft, ChevronRight, Search, Filter, Loader2, Settings, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import api from '../services/api';
import { formatDate } from '../utils';
import { useAuthStore } from '../store/auth';
import type { NKCKINotificationItem, PaginatedResponse, Tenant } from '../types';

const STATUS_COLORS: Record<string, string> = {
  'Проверка НКЦКИ': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Отправлено': 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  'Требуется дополнение': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'Отправлено в архив': 'bg-surface-500/15 text-surface-400 border-surface-500/20',
  'Зарегистрировано': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
};

const TLP_COLORS: Record<string, string> = {
  'TLP:WHITE': 'bg-surface-700 text-surface-300',
  'TLP:GREEN': 'bg-emerald-500/15 text-emerald-400',
  'TLP:AMBER': 'bg-amber-500/15 text-amber-400',
  'TLP:RED': 'bg-red-500/15 text-red-400',
};

export default function SocNkcki() {
  const { user } = useAuthStore();
  const isSoc = user?.role?.startsWith('soc_') || false;
  const isAdmin = user?.role === 'soc_admin';

  const [data, setData] = useState<PaginatedResponse<NKCKINotificationItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);

  // Settings (admin only)
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ nkcki_api_url: '', nkcki_api_token: '', nkcki_api_token_set: false, nkcki_enabled: false });
  const [settingsForm, setSettingsForm] = useState({ url: '', token: '', enabled: false });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showToken, setShowToken] = useState(false);

  const fetchSettings = async () => {
    if (!isAdmin) return;
    setSettingsLoading(true);
    try {
      const { data: s } = await api.get('/nkcki/settings');
      setSettings(s);
      setSettingsForm({ url: s.nkcki_api_url, token: '', enabled: s.nkcki_enabled });
    } catch { /* */ }
    setSettingsLoading(false);
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    setTestResult(null);
    try {
      const payload: Record<string, any> = { nkcki_api_url: settingsForm.url, nkcki_enabled: settingsForm.enabled };
      if (settingsForm.token) payload.nkcki_api_token = settingsForm.token;
      const { data: s } = await api.put('/nkcki/settings', payload);
      setSettings(s);
      setSettingsForm((f) => ({ ...f, token: '' }));
    } catch { /* */ }
    setSettingsSaving(false);
  };

  const testConnection = async () => {
    setTestResult(null);
    try {
      const { data: r } = await api.post('/nkcki/settings/test');
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ success: false, message: e.response?.data?.detail || 'Ошибка' });
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, per_page: 20 };
      if (filterTenant) params.tenant_id = filterTenant;
      if (filterStatus) params.status = filterStatus;
      if (filterCategory) params.category = filterCategory;
      const { data: result } = await api.get('/nkcki/notifications', { params });
      setData(result);
    } catch { /* */ }
    setLoading(false);
  };

  const fetchTenants = async () => {
    try {
      const { data: t } = await api.get('/soc/tenants');
      setTenants(Array.isArray(t) ? t : t.items || []);
    } catch { /* */ }
  };

  useEffect(() => { if (isSoc) fetchTenants(); if (isAdmin) fetchSettings(); }, []);
  useEffect(() => { fetchData(); }, [page, filterTenant, filterStatus, filterCategory]);

  const syncStatus = async (id: string) => {
    setSyncing(id);
    try {
      await api.post(`/nkcki/notifications/${id}/sync`);
      await fetchData();
    } catch { /* */ }
    setSyncing(null);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600/15 flex items-center justify-center">
            <Shield className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-surface-100">НКЦКИ</h1>
            <p className="text-sm text-surface-500">Уведомления, отправленные в ГосСОПКА</p>
          </div>
        </div>
        {data && (
          <span className="text-sm text-surface-500">
            Всего: {data.total}
          </span>
        )}
        {isAdmin && (
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`btn-secondary flex items-center gap-1.5 text-sm ${showSettings ? 'bg-surface-700' : ''}`}
          >
            <Settings className="w-4 h-4" /> Настройки
          </button>
        )}
      </div>

      {/* Settings panel (soc_admin only) */}
      {isAdmin && showSettings && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-200 flex items-center gap-2">
              <Settings className="w-4 h-4 text-surface-400" /> Настройки интеграции НКЦКИ
            </h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${settings.nkcki_enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-surface-700 text-surface-500'}`}>
                {settings.nkcki_enabled ? 'Включено' : 'Отключено'}
              </span>
            </div>
          </div>

          {settingsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-surface-500" /></div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-surface-400 mb-1">API URL</label>
                  <input
                    value={settingsForm.url}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, url: e.target.value }))}
                    className="input text-sm"
                    placeholder="https://lk.cert.gov.ru/api/v2"
                  />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">
                    API токен {settings.nkcki_api_token_set && <span className="text-emerald-400">(установлен: {settings.nkcki_api_token})</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={settingsForm.token}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, token: e.target.value }))}
                      className="input text-sm pr-10"
                      placeholder={settings.nkcki_api_token_set ? 'Оставьте пустым, чтобы не менять' : 'Вставьте API токен'}
                    />
                    <button
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-500 hover:text-surface-300"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-surface-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.enabled}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, enabled: e.target.checked }))}
                    className="rounded border-surface-600 bg-surface-800 text-brand-500"
                  />
                  Интеграция включена
                </label>

                <div className="flex items-center gap-2">
                  {testResult && (
                    <span className={`text-xs flex items-center gap-1 ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult.success ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      {testResult.message}
                    </span>
                  )}
                  <button onClick={testConnection} className="btn-secondary text-sm py-1.5">
                    Тест подключения
                  </button>
                  <button onClick={saveSettings} disabled={settingsSaving} className="btn-primary text-sm py-1.5 flex items-center gap-1.5">
                    {settingsSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Сохранить
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-surface-500" />
        {isSoc && (
          <select
            value={filterTenant}
            onChange={(e) => { setFilterTenant(e.target.value); setPage(1); }}
            className="input text-sm py-1.5 w-48"
          >
            <option value="">Все клиенты</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
          className="input text-sm py-1.5 w-48"
        >
          <option value="">Все категории</option>
          <option value="Уведомление о компьютерном инциденте">КИ</option>
          <option value="Уведомление о компьютерной атаке">КА</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="input text-sm py-1.5 w-48"
        >
          <option value="">Все статусы</option>
          <option value="Проверка НКЦКИ">Проверка НКЦКИ</option>
          <option value="Требуется дополнение">Требуется дополнение</option>
          <option value="Отправлено в архив">Отправлено в архив</option>
          <option value="Зарегистрировано">Зарегистрировано</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data?.items?.length ? (
          <div className="text-center py-16 text-surface-500">
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Нет отправленных уведомлений</p>
            <p className="text-xs mt-1">Отправьте инцидент в НКЦКИ из карточки инцидента</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-800 text-surface-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Рег. номер</th>
                <th className="text-left px-4 py-3 font-medium">Организация</th>
                <th className="text-left px-4 py-3 font-medium">Категория / Тип</th>
                <th className="text-left px-4 py-3 font-medium">TLP</th>
                <th className="text-left px-4 py-3 font-medium">Статус НКЦКИ</th>
                <th className="text-left px-4 py-3 font-medium">Дата отправки</th>
                <th className="text-left px-4 py-3 font-medium">Инцидент</th>
                <th className="text-right px-4 py-3 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((n) => (
                <tr key={n.id} className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-surface-200 text-xs">
                      {n.nkcki_identifier || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-surface-300">{n.company_name}</span>
                    {n.tenant_name && n.tenant_name !== n.company_name && (
                      <span className="block text-xs text-surface-500">{n.tenant_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-surface-400 text-xs">
                      {n.category.includes('инциденте') ? 'КИ' : 'КА'}
                    </span>
                    <span className="block text-surface-300 text-xs mt-0.5">{n.type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TLP_COLORS[n.tlp] || ''}`}>
                      {n.tlp}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge text-xs ${STATUS_COLORS[n.nkcki_status] || 'bg-surface-700 text-surface-400'}`}>
                      {n.nkcki_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-surface-400 text-xs">
                    {formatDate(n.sent_at)}
                    {n.sent_by_name && (
                      <span className="block text-surface-500">{n.sent_by_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {n.incident_id ? (
                      <Link
                        to={`/incidents/${n.incident_id}`}
                        className="text-brand-400 hover:text-brand-300 text-xs flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {n.incident_title
                          ? `${n.incident_title.substring(0, 30)}${n.incident_title.length > 30 ? '…' : ''}`
                          : `#${n.incident_rusiem_id}`}
                      </Link>
                    ) : (
                      <span className="text-xs text-surface-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isSoc && (
                      <button
                        onClick={() => syncStatus(n.id)}
                        disabled={syncing === n.id}
                        className="p-1.5 rounded-lg hover:bg-surface-700 text-surface-500 hover:text-surface-300 transition-colors"
                        title="Синхронизировать статус"
                      >
                        {syncing === n.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <RefreshCw className="w-4 h-4" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-800">
            <span className="text-xs text-surface-500">
              Стр. {data.page} из {data.pages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-surface-800 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(Math.min(data.pages, page + 1))}
                disabled={page >= data.pages}
                className="p-1.5 rounded-lg hover:bg-surface-800 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
