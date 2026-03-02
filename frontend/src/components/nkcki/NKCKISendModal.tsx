import { useEffect, useState } from 'react';
import { X, Send, Loader2, ChevronRight, ChevronLeft, CheckCircle, AlertTriangle, Shield } from 'lucide-react';
import api from '../../services/api';
import type { IncidentDetail, NKCKIDictionaries, NKCKICompany, Tenant } from '../../types';

interface Props {
  incident: IncidentDetail;
  onClose: () => void;
  onSuccess: () => void;
}

export default function NKCKISendModal({ incident, onClose, onSuccess }: Props) {
  const [step, setStep] = useState(1);
  const [dicts, setDicts] = useState<NKCKIDictionaries | null>(null);
  const [companies, setCompanies] = useState<NKCKICompany[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ identifier: string; uuid: string } | null>(null);

  // ── Form state ──
  const [form, setForm] = useState({
    category: 'Уведомление о компьютерном инциденте',
    type: '',
    tlp: 'TLP:GREEN',
    company: '',
    owner_name: '',
    event_description: incident.description || '',
    detection_tool: 'RuSIEM',
    detect_time: incident.rusiem_created_at
      ? new Date(incident.rusiem_created_at).toISOString().slice(0, 16)
      : new Date().toISOString().slice(0, 16),
    end_time: '',
    activity_status: 'Проводятся мероприятия по реагированию',
    affected_system_name: '',
    affected_system_category: 'Объект КИИ без категории значимости',
    affected_system_function: 'Иная',
    affected_system_connection: false,
    location: 'RU-KDA',
    city: '',
    integrity_impact: 'Отсутствует',
    availability_impact: 'Отсутствует',
    confidentiality_impact: 'Отсутствует',
    custom_impact: '',
    assistance: false,
  });

  // ── Load dictionaries & companies ──
  useEffect(() => {
    const load = async () => {
      try {
        const [dictsRes, companiesRes, tenantsRes] = await Promise.all([
          api.get('/nkcki/dictionaries'),
          api.get('/nkcki/companies').catch(() => ({ data: [] })),
          api.get('/soc/tenants'),
        ]);
        setDicts(dictsRes.data);
        setCompanies(Array.isArray(companiesRes.data) ? companiesRes.data : []);
        const t = Array.isArray(tenantsRes.data) ? tenantsRes.data : tenantsRes.data.items || [];
        setTenants(t);

        // Auto-fill company from tenant
        const tenant = t.find((x: Tenant) => x.id === incident.tenant_id);
        if (tenant) {
          setForm((f) => ({ ...f, owner_name: tenant.name, company: tenant.name }));
        }
      } catch { /* */ }
      setLoading(false);
    };
    load();
  }, []);

  const update = (field: string, value: string | boolean) => {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  };

  const isKI = form.category === 'Уведомление о компьютерном инциденте';
  const typeOptions = dicts ? (isKI ? dicts.types_ki : dicts.types_ka) : [];

  // ── Send ──
  const handleSend = async () => {
    if (!form.type || !form.company || !form.event_description || !form.affected_system_name) {
      setError('Заполните все обязательные поля');
      return;
    }
    setSending(true);
    setError('');
    try {
      const payload = {
        incident_id: incident.id,
        tenant_id: incident.tenant_id,
        ...form,
        detect_time: new Date(form.detect_time).toISOString(),
        end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
        technical_data: form.affected_system_connection ? buildTechnicalData() : null,
      };
      const { data } = await api.post('/nkcki/send', payload);
      setSuccess({ identifier: data.nkcki_identifier || '—', uuid: data.nkcki_uuid || '' });
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка отправки');
    }
    setSending(false);
  };

  const buildTechnicalData = () => {
    const tech: Record<string, any> = {};
    // Auto-populate from incident IOC/IPs
    if (incident.source_ips?.length) {
      tech.related_observables_ipv4 = incident.source_ips
        .filter((ip) => !ip.includes(':'))
        .map((ip) => ({ value: ip }));
    }
    if (incident.ioc_indicators?.length) {
      const ips = incident.ioc_indicators.filter((i) => i.type === 'ip');
      if (ips.length) {
        tech.related_indicators_ipv4 = ips.map((i) => ({
          value: i.value,
          function: 'Центр управления ВПО',
        }));
      }
      const domains = incident.ioc_indicators.filter((i) => i.type === 'domain');
      if (domains.length) {
        tech.related_indicators_domain = domains.map((i) => ({
          value: i.value,
          function: 'Источник распространения ВПО',
        }));
      }
      const hashes = incident.ioc_indicators.filter((i) => i.type === 'hash');
      if (hashes.length) {
        tech.malware_hash = hashes.map((i) => ({ value: i.value }));
      }
    }
    return tech;
  };

  if (loading) {
    return (
      <Overlay onClose={onClose}>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
        </div>
      </Overlay>
    );
  }

  if (success) {
    return (
      <Overlay onClose={() => { onClose(); onSuccess(); }}>
        <div className="text-center py-10 px-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-semibold text-surface-100 mb-2">Уведомление отправлено</h2>
          <p className="text-surface-400 mb-1">Регистрационный номер:</p>
          <p className="text-2xl font-mono text-brand-400 mb-6">{success.identifier}</p>
          <button
            onClick={() => { onClose(); onSuccess(); }}
            className="btn-primary px-6"
          >
            Закрыть
          </button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-brand-400" />
          <h2 className="text-lg font-semibold text-surface-100">Отправить в НКЦКИ</h2>
          <span className="text-xs text-surface-500 bg-surface-800 px-2 py-0.5 rounded-full">
            Шаг {step} из 2
          </span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-800 text-surface-500">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-6 py-5 max-h-[calc(100vh-250px)] overflow-y-auto space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {step === 1 && (
          <>
            {/* Classification */}
            <FieldGroup title="Классификация">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Категория *">
                  <select
                    value={form.category}
                    onChange={(e) => { update('category', e.target.value); update('type', ''); }}
                    className="input text-sm"
                  >
                    {dicts?.categories.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Тип события ИБ *">
                  <select
                    value={form.type}
                    onChange={(e) => update('type', e.target.value)}
                    className="input text-sm"
                  >
                    <option value="">— Выберите —</option>
                    {typeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="TLP *">
                  <select value={form.tlp} onChange={(e) => update('tlp', e.target.value)} className="input text-sm">
                    {dicts?.tlp.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Статус реагирования *">
                  <select value={form.activity_status} onChange={(e) => update('activity_status', e.target.value)} className="input text-sm">
                    {dicts?.activity_statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
            </FieldGroup>

            {/* Organization */}
            <FieldGroup title="Организация">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Организация (company) *">
                  {companies.length > 0 ? (
                    <select value={form.company} onChange={(e) => update('company', e.target.value)} className="input text-sm">
                      <option value="">— Выберите —</option>
                      {companies.map((c) => (
                        <option key={c.uuid} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form.company}
                      onChange={(e) => update('company', e.target.value)}
                      className="input text-sm"
                      placeholder="Краткое наименование организации"
                    />
                  )}
                </Field>
                <Field label="Владелец ресурса *">
                  <input
                    value={form.owner_name}
                    onChange={(e) => update('owner_name', e.target.value)}
                    className="input text-sm"
                    placeholder="Наименование организации"
                  />
                </Field>
              </div>
            </FieldGroup>

            {/* Description */}
            <FieldGroup title="Описание">
              <Field label="Описание события ИБ *">
                <textarea
                  value={form.event_description}
                  onChange={(e) => update('event_description', e.target.value)}
                  className="input text-sm min-h-[80px] resize-y"
                  placeholder="Краткое описание события информационной безопасности"
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Средство обнаружения">
                  <input
                    value={form.detection_tool}
                    onChange={(e) => update('detection_tool', e.target.value)}
                    className="input text-sm"
                  />
                </Field>
                <Field label="Дата выявления *">
                  <input
                    type="datetime-local"
                    value={form.detect_time}
                    onChange={(e) => update('detect_time', e.target.value)}
                    className="input text-sm"
                  />
                </Field>
                <Field label="Дата завершения">
                  <input
                    type="datetime-local"
                    value={form.end_time}
                    onChange={(e) => update('end_time', e.target.value)}
                    className="input text-sm"
                  />
                </Field>
              </div>
            </FieldGroup>

            {/* Assistance */}
            <label className="flex items-center gap-2 text-sm text-surface-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.assistance}
                onChange={(e) => update('assistance', e.target.checked)}
                className="rounded border-surface-600 bg-surface-800 text-brand-500"
              />
              Необходимо содействие ГосСОПКА
            </label>
          </>
        )}

        {step === 2 && (
          <>
            {/* Affected system */}
            <FieldGroup title="Атакованный объект">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Наименование ресурса *">
                  <input
                    value={form.affected_system_name}
                    onChange={(e) => update('affected_system_name', e.target.value)}
                    className="input text-sm"
                    placeholder="Название информационной системы"
                  />
                </Field>
                <Field label="Категория ОКИИ *">
                  <select value={form.affected_system_category} onChange={(e) => update('affected_system_category', e.target.value)} className="input text-sm">
                    {dicts?.affected_system_categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Сфера функционирования *">
                  <select value={form.affected_system_function} onChange={(e) => update('affected_system_function', e.target.value)} className="input text-sm">
                    {dicts?.affected_system_functions.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="Локация (ISO-3166-2) *">
                  <input
                    value={form.location}
                    onChange={(e) => update('location', e.target.value)}
                    className="input text-sm"
                    placeholder="RU-KDA"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Населённый пункт">
                  <input
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                    className="input text-sm"
                    placeholder="Краснодар"
                  />
                </Field>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-surface-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.affected_system_connection}
                      onChange={(e) => update('affected_system_connection', e.target.checked)}
                      className="rounded border-surface-600 bg-surface-800 text-brand-500"
                    />
                    Подключение к интернету
                  </label>
                </div>
              </div>
            </FieldGroup>

            {/* Impact (КИ only) */}
            {isKI && (
              <FieldGroup title="Влияние">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Целостность">
                    <select value={form.integrity_impact} onChange={(e) => update('integrity_impact', e.target.value)} className="input text-sm">
                      {dicts?.impacts.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </Field>
                  <Field label="Доступность">
                    <select value={form.availability_impact} onChange={(e) => update('availability_impact', e.target.value)} className="input text-sm">
                      {dicts?.impacts.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </Field>
                  <Field label="Конфиденциальность">
                    <select value={form.confidentiality_impact} onChange={(e) => update('confidentiality_impact', e.target.value)} className="input text-sm">
                      {dicts?.impacts.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Иные последствия">
                  <input
                    value={form.custom_impact}
                    onChange={(e) => update('custom_impact', e.target.value)}
                    className="input text-sm"
                    placeholder="Описание иных последствий"
                  />
                </Field>
              </FieldGroup>
            )}

            {/* Auto-populated technical info notice */}
            {form.affected_system_connection && incident.ioc_indicators?.length > 0 && (
              <div className="p-3 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 text-sm">
                <p className="font-medium mb-1">Технические сведения</p>
                <p className="text-brand-400/70 text-xs">
                  IP-адреса и индикаторы компрометации из карточки инцидента будут автоматически добавлены к уведомлению.
                  {incident.source_ips?.length > 0 && ` IP: ${incident.source_ips.join(', ')}.`}
                  {incident.ioc_indicators?.length > 0 && ` IOC: ${incident.ioc_indicators.length} шт.`}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-surface-800 bg-surface-900/50">
        <div>
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} className="btn-secondary flex items-center gap-1.5 text-sm">
              <ChevronLeft className="w-4 h-4" /> Назад
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          {step < 2 ? (
            <button onClick={() => setStep(step + 1)} className="btn-primary flex items-center gap-1.5 text-sm">
              Далее <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={sending}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Отправить в НКЦКИ
            </button>
          )}
        </div>
      </div>
    </Overlay>
  );
}


// ── Helpers ──────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-900 border border-surface-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-surface-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
