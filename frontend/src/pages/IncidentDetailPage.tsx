import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Clock, Monitor, Globe, Tag, User,
  MessageSquare, Send, ChevronDown, Shield, CheckCircle,
  AlertTriangle, Loader2, Download, Eye, Plus, Trash2,
  Server, Hash, Link as LinkIcon, Mail, Activity,
} from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth';
import {
  formatDate, timeAgo, priorityLabel, statusLabel,
  statusBadgeClass, priorityBadgeClass,
} from '../utils';
import type { IncidentDetail, IOCIndicator, AffectedAsset } from '../types';

const IOC_TYPES = [
  { value: 'ip', label: 'IP-адрес', icon: Monitor },
  { value: 'domain', label: 'Домен', icon: Globe },
  { value: 'hash', label: 'Хеш (MD5/SHA)', icon: Hash },
  { value: 'url', label: 'URL', icon: LinkIcon },
  { value: 'email', label: 'Email', icon: Mail },
];

const ASSET_TYPES = [
  { value: 'server', label: 'Сервер' },
  { value: 'workstation', label: 'АРМ' },
  { value: 'network', label: 'Сетевое оборудование' },
  { value: 'user_account', label: 'Учётная запись' },
];

const CRITICALITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/20',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
};

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const isSoc = user?.role?.startsWith('soc_') || false;

  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);
  const [showIocForm, setShowIocForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [iocSaving, setIocSaving] = useState(false);

  // IOC form
  const [newIoc, setNewIoc] = useState<IOCIndicator>({ type: 'ip', value: '', context: '' });
  const [newAsset, setNewAsset] = useState<AffectedAsset>({ name: '', type: 'server', ip: '', criticality: 'medium' });

  const fetchIncident = async () => {
    try {
      const endpoint = isSoc ? `/soc/incidents/${id}` : `/incidents/${id}`;
      const { data } = await api.get(endpoint);
      setIncident(data);
    } catch {
      setIncident(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchIncident(); }, [id]);

  const addComment = async () => {
    if (!comment.trim() || !id) return;
    setSending(true);
    try {
      const endpoint = isSoc ? `/soc/incidents/${id}/comments` : `/incidents/${id}/comments`;
      await api.post(endpoint, { text: comment });
      setComment('');
      await fetchIncident();
    } catch { /* */ }
    setSending(false);
  };

  const changeStatus = async (newStatus: string) => {
    if (!id) return;
    try {
      const endpoint = isSoc
        ? `/soc/incidents/${id}/status?new_status=${newStatus}`
        : `/incidents/${id}/status`;
      const body = isSoc ? undefined : { status: newStatus };
      await api.put(endpoint, body);
      await fetchIncident();
    } catch { /* */ }
    setStatusDropdown(false);
  };

  const acknowledge = async () => {
    if (!id) return;
    setAckLoading(true);
    try {
      await api.put(`/incidents/${id}/acknowledge`);
      await fetchIncident();
    } catch { /* */ }
    setAckLoading(false);
  };

  const addIoc = async () => {
    if (!newIoc.value.trim() || !incident) return;
    setIocSaving(true);
    try {
      const updated = [...(incident.ioc_indicators || []), { ...newIoc }];
      await api.put(`/soc/incidents/${id}/ioc-assets`, { ioc_indicators: updated });
      setNewIoc({ type: 'ip', value: '', context: '' });
      setShowIocForm(false);
      await fetchIncident();
    } catch { /* */ }
    setIocSaving(false);
  };

  const removeIoc = async (idx: number) => {
    if (!incident) return;
    const updated = incident.ioc_indicators.filter((_, i) => i !== idx);
    try {
      await api.put(`/soc/incidents/${id}/ioc-assets`, { ioc_indicators: updated });
      await fetchIncident();
    } catch { /* */ }
  };

  const addAsset = async () => {
    if (!newAsset.name.trim() || !incident) return;
    setIocSaving(true);
    try {
      const updated = [...(incident.affected_assets || []), { ...newAsset }];
      await api.put(`/soc/incidents/${id}/ioc-assets`, { affected_assets: updated });
      setNewAsset({ name: '', type: 'server', ip: '', criticality: 'medium' });
      setShowAssetForm(false);
      await fetchIncident();
    } catch { /* */ }
    setIocSaving(false);
  };

  const removeAsset = async (idx: number) => {
    if (!incident) return;
    const updated = incident.affected_assets.filter((_, i) => i !== idx);
    try {
      await api.put(`/soc/incidents/${id}/ioc-assets`, { affected_assets: updated });
      await fetchIncident();
    } catch { /* */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-10 h-10 text-surface-600 mx-auto mb-3" />
        <p className="text-surface-400">Инцидент не найден</p>
        <Link to="/incidents" className="text-brand-400 text-sm hover:underline mt-2 inline-block">
          ← Назад к списку
        </Link>
      </div>
    );
  }

  const allowedTransitions = isSoc ? getSocTransitions(incident.status) : getClientTransitions(incident.status);

  return (
    <div className="space-y-6 animate-in max-w-5xl">
      {/* Back */}
      <Link to="/incidents" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-300 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Назад к инцидентам
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-xs font-mono text-surface-500 bg-surface-800 px-2 py-0.5 rounded">
              #{incident.rusiem_incident_id}
            </span>
            <span className={`badge ${priorityBadgeClass[incident.priority]}`}>
              {priorityLabel[incident.priority]}
            </span>
            <span className={`badge ${statusBadgeClass[incident.status]}`}>
              {statusLabel[incident.status]}
            </span>
            {incident.acknowledged_at && (
              <span className="badge bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <Eye className="w-3 h-3" /> Подтверждён
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold text-surface-100">{incident.title}</h1>
          <p className="text-sm text-surface-500 mt-1">
            Опубликован {formatDate(incident.published_at)} · {incident.published_by_name}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Acknowledge button (client only, if not yet acknowledged) */}
          {!isSoc && !incident.acknowledged_at && (
            <button onClick={acknowledge} disabled={ackLoading} className="btn-primary flex items-center gap-1.5 text-sm">
              {ackLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              Подтвердить
            </button>
          )}

          {/* Status change */}
          {allowedTransitions.length > 0 && (
            <div className="relative">
              <button onClick={() => setStatusDropdown(!statusDropdown)} className="btn-secondary flex items-center gap-1.5 text-sm">
                Сменить статус <ChevronDown className="w-4 h-4" />
              </button>
              {statusDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStatusDropdown(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 card p-1.5 z-20 shadow-xl">
                    {allowedTransitions.map((s) => (
                      <button key={s} onClick={() => changeStatus(s)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-surface-800 text-surface-300">
                        → {statusLabel[s] || s}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* PDF */}
          <button
            onClick={async () => {
              try {
                const resp = await api.get(`/reports/incident/${id}`, { responseType: 'blob' });
                const url = window.URL.createObjectURL(resp.data);
                const a = document.createElement('a');
                a.href = url; a.download = `incident_${incident.rusiem_incident_id}.pdf`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
              } catch { /* */ }
            }}
            className="btn-secondary flex items-center gap-1.5 text-sm"
          >
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Left: main content */}
        <div className="col-span-2 space-y-5">
          {/* Description */}
          {incident.description && (
            <Section title="Описание">
              <p className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">{incident.description}</p>
            </Section>
          )}

          {/* SOC Recommendations */}
          {incident.recommendations && (
            <Section title="Рекомендации по реагированию" icon={Shield} accent>
              <div className="text-sm text-surface-200 whitespace-pre-wrap leading-relaxed">{incident.recommendations}</div>
            </Section>
          )}

          {/* SOC Actions */}
          {incident.soc_actions && (
            <Section title="Выполненные действия SOC" icon={CheckCircle}>
              <div className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">{incident.soc_actions}</div>
            </Section>
          )}

          {/* IOC Indicators */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-surface-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                IOC-индикаторы ({incident.ioc_indicators?.length || 0})
              </h3>
              {isSoc && (
                <button onClick={() => setShowIocForm(!showIocForm)} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Добавить
                </button>
              )}
            </div>

            {(incident.ioc_indicators?.length || 0) > 0 ? (
              <div className="space-y-2">
                {incident.ioc_indicators.map((ioc, i) => {
                  const iocType = IOC_TYPES.find(t => t.value === ioc.type);
                  const Icon = iocType?.icon || Tag;
                  return (
                    <div key={i} className="flex items-center gap-3 py-2 px-3 bg-surface-800/60 rounded-lg group">
                      <Icon className="w-4 h-4 text-red-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-semibold text-surface-500 bg-surface-700 px-1.5 py-0.5 rounded">
                            {iocType?.label || ioc.type}
                          </span>
                          <span className="text-sm font-mono text-surface-200 truncate">{ioc.value}</span>
                        </div>
                        {ioc.context && <p className="text-xs text-surface-500 mt-0.5">{ioc.context}</p>}
                      </div>
                      {isSoc && (
                        <button onClick={() => removeIoc(i)} className="opacity-0 group-hover:opacity-100 text-surface-600 hover:text-red-400 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-surface-600">IOC-индикаторы не добавлены</p>
            )}

            {/* IOC form */}
            {showIocForm && (
              <div className="mt-3 p-3 bg-surface-800/40 rounded-lg border border-surface-700 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <select value={newIoc.type} onChange={e => setNewIoc({ ...newIoc, type: e.target.value })} className="input text-sm">
                    {IOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input value={newIoc.value} onChange={e => setNewIoc({ ...newIoc, value: e.target.value })} placeholder="Значение" className="input text-sm col-span-2" />
                </div>
                <input value={newIoc.context || ''} onChange={e => setNewIoc({ ...newIoc, context: e.target.value })} placeholder="Контекст (необязательно)" className="input text-sm w-full" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowIocForm(false)} className="btn-secondary text-xs px-3 py-1">Отмена</button>
                  <button onClick={addIoc} disabled={!newIoc.value.trim() || iocSaving} className="btn-primary text-xs px-3 py-1">
                    {iocSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Добавить'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Affected Assets */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-surface-300 flex items-center gap-2">
                <Server className="w-4 h-4 text-amber-400" />
                Затронутые активы ({incident.affected_assets?.length || 0})
              </h3>
              {isSoc && (
                <button onClick={() => setShowAssetForm(!showAssetForm)} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Добавить
                </button>
              )}
            </div>

            {(incident.affected_assets?.length || 0) > 0 ? (
              <div className="space-y-2">
                {incident.affected_assets.map((asset, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 px-3 bg-surface-800/60 rounded-lg group">
                    <Server className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-surface-200">{asset.name}</span>
                        <span className="text-[10px] uppercase text-surface-500 bg-surface-700 px-1.5 py-0.5 rounded">
                          {ASSET_TYPES.find(t => t.value === asset.type)?.label || asset.type}
                        </span>
                        {asset.criticality && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CRITICALITY_COLORS[asset.criticality] || 'text-surface-400'}`}>
                            {asset.criticality}
                          </span>
                        )}
                      </div>
                      {asset.ip && <p className="text-xs font-mono text-surface-500 mt-0.5">{asset.ip}</p>}
                    </div>
                    {isSoc && (
                      <button onClick={() => removeAsset(i)} className="opacity-0 group-hover:opacity-100 text-surface-600 hover:text-red-400 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-surface-600">Затронутые активы не указаны</p>
            )}

            {/* Asset form */}
            {showAssetForm && (
              <div className="mt-3 p-3 bg-surface-800/40 rounded-lg border border-surface-700 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={newAsset.name} onChange={e => setNewAsset({ ...newAsset, name: e.target.value })} placeholder="Название актива" className="input text-sm" />
                  <select value={newAsset.type} onChange={e => setNewAsset({ ...newAsset, type: e.target.value })} className="input text-sm">
                    {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={newAsset.ip || ''} onChange={e => setNewAsset({ ...newAsset, ip: e.target.value })} placeholder="IP-адрес" className="input text-sm" />
                  <select value={newAsset.criticality || 'medium'} onChange={e => setNewAsset({ ...newAsset, criticality: e.target.value })} className="input text-sm">
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowAssetForm(false)} className="btn-secondary text-xs px-3 py-1">Отмена</button>
                  <button onClick={addAsset} disabled={!newAsset.name.trim() || iocSaving} className="btn-primary text-xs px-3 py-1">
                    {iocSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Добавить'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Client Response */}
          {incident.client_response && (
            <Section title="Ответ клиента">
              <div className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">{incident.client_response}</div>
            </Section>
          )}

          {/* Comments */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Комментарии ({incident.comments.length})
            </h3>

            {incident.comments.length > 0 ? (
              <div className="space-y-3 mb-4">
                {incident.comments.map((c) => (
                  <div key={c.id} className={`p-3 rounded-lg text-sm ${c.is_soc ? 'bg-brand-600/5 border border-brand-600/10' : 'bg-surface-800/60 border border-surface-700/50'}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-medium text-surface-200">{c.user_name}</span>
                      {c.is_soc && <span className="text-[10px] font-semibold text-brand-400 bg-brand-400/10 px-1.5 py-0.5 rounded uppercase">SOC</span>}
                      <span className="text-xs text-surface-500 ml-auto">{timeAgo(c.created_at)}</span>
                    </div>
                    <p className="text-surface-300 whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-surface-600 mb-4">Комментариев пока нет</p>
            )}

            <div className="flex gap-2">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Написать комментарий..." rows={2} className="input resize-none" />
              <button onClick={addComment} disabled={!comment.trim() || sending} className="btn-primary px-3 self-end">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Acknowledgment card */}
          {incident.acknowledged_at ? (
            <div className="card p-4 border-emerald-500/20 bg-emerald-500/[0.03]">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400 uppercase">Подтверждён клиентом</span>
              </div>
              <p className="text-xs text-surface-400">
                {incident.acknowledged_by_name} · {formatDate(incident.acknowledged_at)}
              </p>
            </div>
          ) : (
            <div className="card p-4 border-amber-500/20 bg-amber-500/[0.03]">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold text-amber-400 uppercase">Ожидает подтверждения</span>
              </div>
            </div>
          )}

          {/* Technical details */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
              Техническая информация
            </h3>
            <MetaRow icon={Tag} label="Категория" value={incident.category || '—'} />
            <MetaRow icon={Tag} label="MITRE" value={incident.mitre_id || '—'} />
            <MetaRow icon={AlertTriangle} label="Событий" value={String(incident.event_count)} />
            {incident.source_ips.length > 0 && <MetaRow icon={Monitor} label="Source IP" value={incident.source_ips.join(', ')} />}
            {incident.source_hostnames.length > 0 && <MetaRow icon={Monitor} label="Hostname" value={incident.source_hostnames.join(', ')} />}
            {incident.event_source_ips.length > 0 && <MetaRow icon={Globe} label="Event Source" value={incident.event_source_ips.join(', ')} />}
            {incident.symptoms.length > 0 && <MetaRow icon={AlertTriangle} label="Симптомы" value={incident.symptoms.join(', ')} />}
            <MetaRow icon={Clock} label="Обнаружен" value={formatDate(incident.rusiem_created_at)} />
            <MetaRow icon={User} label="Опубликовал" value={incident.published_by_name} />
            {incident.closed_by_name && <MetaRow icon={CheckCircle} label="Закрыл" value={incident.closed_by_name} />}
          </div>

          {/* Timeline */}
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Хронология
            </h3>
            <div className="space-y-0">
              {/* Published event */}
              <TimelineItem
                color="bg-brand-500"
                title="Инцидент опубликован"
                sub={`${incident.published_by_name} · ${formatDate(incident.published_at)}`}
                last={!incident.acknowledged_at && incident.status_history.length === 0}
              />

              {/* Acknowledged event */}
              {incident.acknowledged_at && (
                <TimelineItem
                  color="bg-emerald-500"
                  title="Подтверждён клиентом"
                  sub={`${incident.acknowledged_by_name || ''} · ${formatDate(incident.acknowledged_at)}`}
                  last={incident.status_history.length === 0}
                />
              )}

              {/* Status changes */}
              {incident.status_history.map((sh, i) => (
                <TimelineItem
                  key={i}
                  color="bg-brand-500"
                  title={`${statusLabel[sh.old_status] || sh.old_status} → ${statusLabel[sh.new_status] || sh.new_status}`}
                  sub={`${sh.user_name} · ${timeAgo(sh.created_at)}`}
                  comment={sh.comment}
                  last={i === incident.status_history.length - 1}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function Section({ title, icon: Icon, accent, children }: {
  title: string; icon?: React.ElementType; accent?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`card p-5 ${accent ? 'border-brand-600/20 bg-brand-600/[0.03]' : ''}`}>
      <h3 className="text-sm font-semibold text-surface-300 mb-3 flex items-center gap-2">
        {Icon && <Icon className={`w-4 h-4 ${accent ? 'text-brand-400' : 'text-surface-500'}`} />}
        {title}
      </h3>
      {children}
    </div>
  );
}

function MetaRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-surface-600 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-surface-500">{label}</p>
        <p className="text-xs text-surface-300 font-mono break-all">{value}</p>
      </div>
    </div>
  );
}

function TimelineItem({ color, title, sub, comment, last }: {
  color: string; title: string; sub: string; comment?: string | null; last: boolean;
}) {
  return (
    <div className="flex gap-3 pb-3 last:pb-0">
      <div className="flex flex-col items-center">
        <div className={`w-2 h-2 rounded-full ${color} mt-1.5`} />
        {!last && <div className="w-px flex-1 bg-surface-700 mt-1" />}
      </div>
      <div className="pb-2">
        <p className="text-xs text-surface-300 font-medium">{title}</p>
        <p className="text-[11px] text-surface-500 mt-0.5">{sub}</p>
        {comment && <p className="text-xs text-surface-400 mt-0.5 italic">«{comment}»</p>}
      </div>
    </div>
  );
}

function getClientTransitions(status: string): string[] {
  const map: Record<string, string[]> = {
    new: ['in_progress'],
    in_progress: ['awaiting_soc', 'resolved'],
    awaiting_customer: ['in_progress'],
    resolved: ['closed'],
  };
  return map[status] || [];
}

function getSocTransitions(status: string): string[] {
  const map: Record<string, string[]> = {
    new: ['in_progress'],
    in_progress: ['awaiting_customer', 'resolved', 'false_positive'],
    awaiting_soc: ['in_progress', 'resolved'],
    awaiting_customer: ['in_progress'],
    resolved: ['closed', 'in_progress'],
  };
  return map[status] || [];
}
