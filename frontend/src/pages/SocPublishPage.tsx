import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, AlertTriangle, CheckCircle, Send,
  Monitor, Globe, Tag, Clock, ArrowLeft,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { priorityLabel, priorityBadgeClass } from '../utils';
import type { IncidentPreview, Tenant } from '../types';

export default function SocPublishPage() {
  const navigate = useNavigate();

  // Step 1: Enter RuSIEM ID and preview
  const [rusiemlId, setRusiemId] = useState('');
  const [preview, setPreview] = useState<IncidentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Step 2: Select tenant + fill fields
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [socActions, setSocActions] = useState('');

  // Step 3: Publish
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [published, setPublished] = useState(false);
  const [publishedId, setPublishedId] = useState('');

  // ── Fetch preview ──────────────────────────────────────────

  const fetchPreview = async () => {
    if (!rusiemlId) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const { data } = await api.get(`/soc/incidents/preview/${rusiemlId}`);
      setPreview(data);

      // Also fetch tenants list
      try {
        const { data: t } = await api.get('/soc/tenants');
        setTenants(t.items || t || []);
      } catch {
        // Tenants endpoint might not return data yet, allow manual entry
      }
    } catch (err: any) {
      setPreviewError(
        err.response?.data?.detail || `Не удалось загрузить инцидент #${rusiemlId}`
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Publish ────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!selectedTenant || !recommendations.trim()) return;
    setPublishing(true);
    setPublishError('');
    try {
      const { data } = await api.post('/soc/incidents/publish', {
        rusiem_incident_id: Number(rusiemlId),
        tenant_id: selectedTenant,
        recommendations,
        soc_actions: socActions || null,
      });
      setPublished(true);
      setPublishedId(data.id);
    } catch (err: any) {
      setPublishError(err.response?.data?.detail || 'Ошибка публикации');
    } finally {
      setPublishing(false);
    }
  };

  // ── Success state ──────────────────────────────────────────

  if (published) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center animate-in">
        <div className="card p-10">
          <CheckCircle className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-surface-100 mb-2">Инцидент опубликован</h2>
          <p className="text-sm text-surface-400 mb-6">
            Инцидент #{rusiemlId} опубликован клиенту. Уведомление отправлено.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to={`/incidents/${publishedId}`}
              className="btn-primary flex items-center gap-2"
            >
              Открыть инцидент
            </Link>
            <button
              onClick={() => {
                setPublished(false);
                setPreview(null);
                setRusiemId('');
                setRecommendations('');
                setSocActions('');
                setSelectedTenant('');
              }}
              className="btn-secondary"
            >
              Опубликовать ещё
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in max-w-4xl">
      <Link
        to="/soc"
        className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-300 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> SOC обзор
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-surface-100">Публикация инцидента</h1>
        <p className="text-sm text-surface-500 mt-1">
          Введите ID из RuSIEM → проверьте данные → выберите клиента → опубликуйте
        </p>
      </div>

      {/* Step 1: RuSIEM ID */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-surface-300 mb-3">
          Шаг 1 — Загрузить инцидент из RuSIEM
        </h2>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
            <input
              type="text"
              value={rusiemlId}
              onChange={(e) => setRusiemId(e.target.value.replace(/\D/g, ''))}
              className="input pl-9 font-mono"
              placeholder="ID инцидента в RuSIEM"
              onKeyDown={(e) => e.key === 'Enter' && fetchPreview()}
            />
          </div>
          <button
            onClick={fetchPreview}
            disabled={!rusiemlId || previewLoading}
            className="btn-primary flex items-center gap-2"
          >
            {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Загрузить
          </button>
        </div>
        {previewError && (
          <p className="mt-3 text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {previewError}
          </p>
        )}
      </div>

      {/* Preview card */}
      {preview && (
        <div className="card p-5 border-brand-600/20 animate-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-surface-300">
              Данные из RuSIEM (автозаполнение)
            </h2>
            <span className={`badge ${priorityBadgeClass[preview.priority]}`}>
              {priorityLabel[preview.priority] || preview.priority}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <PreviewField label="Название" value={preview.title} full />
            {preview.description && (
              <PreviewField label="Описание" value={preview.description} full />
            )}
            <PreviewField label="Категория" value={preview.category || '—'} />
            <PreviewField label="MITRE" value={preview.mitre_id || '—'} />
            <PreviewField label="Событий" value={String(preview.event_count)} />
            <PreviewField label="Статус в RuSIEM" value={preview.rusiem_status} />

            {preview.source_ips.length > 0 && (
              <PreviewField icon={Monitor} label="Source IPs" value={preview.source_ips.join(', ')} />
            )}
            {preview.source_hostnames.length > 0 && (
              <PreviewField icon={Monitor} label="Hostnames" value={preview.source_hostnames.join(', ')} />
            )}
            {preview.event_source_ips.length > 0 && (
              <PreviewField icon={Globe} label="Event Source IPs" value={preview.event_source_ips.join(', ')} />
            )}
            {preview.symptoms.length > 0 && (
              <PreviewField icon={Tag} label="Симптомы" value={preview.symptoms.join(', ')} full />
            )}
          </div>
        </div>
      )}

      {/* Step 2: Tenant + Recommendations */}
      {preview && (
        <div className="card p-5 animate-in">
          <h2 className="text-sm font-semibold text-surface-300 mb-4">
            Шаг 2 — Клиент и рекомендации
          </h2>

          <div className="space-y-4">
            {/* Tenant selection */}
            <div>
              <label className="block text-sm font-medium text-surface-400 mb-1.5">
                Клиент (tenant) *
              </label>
              {tenants.length > 0 ? (
                <select
                  value={selectedTenant}
                  onChange={(e) => setSelectedTenant(e.target.value)}
                  className="input"
                >
                  <option value="">Выберите клиента</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.short_name})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={selectedTenant}
                  onChange={(e) => setSelectedTenant(e.target.value)}
                  className="input font-mono"
                  placeholder="UUID клиента (tenants ещё не загружены)"
                />
              )}
            </div>

            {/* Recommendations */}
            <div>
              <label className="block text-sm font-medium text-surface-400 mb-1.5">
                Рекомендации по реагированию *
              </label>
              <textarea
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                className="input resize-none"
                rows={5}
                placeholder={`Что клиенту необходимо сделать:\n1. Сменить пароль учётной записи\n2. Проверить журналы входа за 7 дней\n3. Включить MFA для пользователя`}
              />
            </div>

            {/* SOC Actions */}
            <div>
              <label className="block text-sm font-medium text-surface-400 mb-1.5">
                Выполненные действия SOC
                <span className="font-normal text-surface-600 ml-1">(необязательно)</span>
              </label>
              <textarea
                value={socActions}
                onChange={(e) => setSocActions(e.target.value)}
                className="input resize-none"
                rows={3}
                placeholder={`Что SOC уже сделал:\n- Заблокировал учётную запись через EDR\n- Сбросил сессии на DC02`}
              />
            </div>

            {publishError && (
              <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {publishError}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={handlePublish}
                disabled={!selectedTenant || !recommendations.trim() || publishing}
                className="btn-primary flex items-center gap-2"
              >
                {publishing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Опубликовать клиенту
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewField({
  icon: Icon, label, value, full,
}: {
  icon?: React.ElementType; label: string; value: string; full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {Icon && <Icon className="w-3 h-3 text-surface-600" />}
        <span className="text-xs text-surface-500">{label}</span>
      </div>
      <p className="text-sm text-surface-200 font-mono break-all">{value}</p>
    </div>
  );
}
