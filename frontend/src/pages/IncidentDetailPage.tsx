import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Clock, Monitor, Globe, Tag, User,
  MessageSquare, Send, ChevronDown, Shield, CheckCircle,
  AlertTriangle, Loader2,
} from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth';
import {
  formatDate, timeAgo, priorityLabel, statusLabel,
  statusBadgeClass, priorityBadgeClass,
} from '../utils';
import type { IncidentDetail } from '../types';

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const isSoc = user?.role?.startsWith('soc_');

  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [statusDropdown, setStatusDropdown] = useState(false);

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

  useEffect(() => {
    fetchIncident();
  }, [id]);

  const addComment = async () => {
    if (!comment.trim() || !id) return;
    setSending(true);
    try {
      const endpoint = isSoc
        ? `/soc/incidents/${id}/comments`
        : `/incidents/${id}/comments`;
      await api.post(endpoint, { text: comment });
      setComment('');
      await fetchIncident();
    } catch {}
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
    } catch {}
    setStatusDropdown(false);
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

  const allowedTransitions = getClientTransitions(incident.status);

  return (
    <div className="space-y-6 animate-in max-w-5xl">
      {/* Back */}
      <Link
        to="/incidents"
        className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-300 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Назад к инцидентам
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-mono text-surface-500 bg-surface-800 px-2 py-0.5 rounded">
              #{incident.rusiem_incident_id}
            </span>
            <span className={`badge ${priorityBadgeClass[incident.priority]}`}>
              {priorityLabel[incident.priority]}
            </span>
            <span className={`badge ${statusBadgeClass[incident.status]}`}>
              {statusLabel[incident.status]}
            </span>
          </div>
          <h1 className="text-xl font-semibold text-surface-100">{incident.title}</h1>
          <p className="text-sm text-surface-500 mt-1">
            Опубликован {formatDate(incident.published_at)} · {incident.published_by_name}
          </p>
        </div>

        {/* Status change dropdown */}
        {allowedTransitions.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setStatusDropdown(!statusDropdown)}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              Сменить статус
              <ChevronDown className="w-4 h-4" />
            </button>
            {statusDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setStatusDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 card p-1.5 z-20 shadow-xl">
                  {allowedTransitions.map((s) => (
                    <button
                      key={s}
                      onClick={() => changeStatus(s)}
                      className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-surface-800 text-surface-300 transition-colors"
                    >
                      → {statusLabel[s] || s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Left: main content */}
        <div className="col-span-2 space-y-5">
          {/* Description */}
          {incident.description && (
            <Section title="Описание">
              <p className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">
                {incident.description}
              </p>
            </Section>
          )}

          {/* SOC Recommendations */}
          {incident.recommendations && (
            <Section title="Рекомендации по реагированию" icon={Shield} accent>
              <div className="text-sm text-surface-200 whitespace-pre-wrap leading-relaxed">
                {incident.recommendations}
              </div>
            </Section>
          )}

          {/* SOC Actions */}
          {incident.soc_actions && (
            <Section title="Выполненные действия SOC" icon={CheckCircle}>
              <div className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">
                {incident.soc_actions}
              </div>
            </Section>
          )}

          {/* Client Response */}
          {incident.client_response && (
            <Section title="Ответ клиента">
              <div className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">
                {incident.client_response}
              </div>
            </Section>
          )}

          {/* Comments thread */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Комментарии ({incident.comments.length})
            </h3>

            {incident.comments.length > 0 ? (
              <div className="space-y-3 mb-4">
                {incident.comments.map((c) => (
                  <div
                    key={c.id}
                    className={`p-3 rounded-lg text-sm ${
                      c.is_soc
                        ? 'bg-brand-600/5 border border-brand-600/10'
                        : 'bg-surface-800/60 border border-surface-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-medium text-surface-200">{c.user_name}</span>
                      {c.is_soc && (
                        <span className="text-[10px] font-semibold text-brand-400 bg-brand-400/10 px-1.5 py-0.5 rounded uppercase">
                          SOC
                        </span>
                      )}
                      <span className="text-xs text-surface-500 ml-auto">{timeAgo(c.created_at)}</span>
                    </div>
                    <p className="text-surface-300 whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-surface-600 mb-4">Комментариев пока нет</p>
            )}

            {/* Add comment */}
            <div className="flex gap-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Написать комментарий..."
                rows={2}
                className="input resize-none"
              />
              <button
                onClick={addComment}
                disabled={!comment.trim() || sending}
                className="btn-primary px-3 self-end"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right sidebar: metadata + timeline */}
        <div className="space-y-4">
          {/* Technical details */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
              Техническая информация
            </h3>

            <MetaRow icon={Tag} label="Категория" value={incident.category || '—'} />
            <MetaRow icon={Tag} label="MITRE" value={incident.mitre_id || '—'} />
            <MetaRow icon={AlertTriangle} label="Событий" value={String(incident.event_count)} />

            {incident.source_ips.length > 0 && (
              <MetaRow icon={Monitor} label="Source IP" value={incident.source_ips.join(', ')} />
            )}
            {incident.source_hostnames.length > 0 && (
              <MetaRow icon={Monitor} label="Hostname" value={incident.source_hostnames.join(', ')} />
            )}
            {incident.event_source_ips.length > 0 && (
              <MetaRow icon={Globe} label="Event Source" value={incident.event_source_ips.join(', ')} />
            )}
            {incident.symptoms.length > 0 && (
              <MetaRow icon={AlertTriangle} label="Симптомы" value={incident.symptoms.join(', ')} />
            )}

            <MetaRow icon={Clock} label="Обнаружен" value={formatDate(incident.rusiem_created_at)} />
            <MetaRow icon={User} label="Опубликовал" value={incident.published_by_name} />
            {incident.closed_by_name && (
              <MetaRow icon={CheckCircle} label="Закрыл" value={incident.closed_by_name} />
            )}
          </div>

          {/* Status timeline */}
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">
              Хронология
            </h3>
            <div className="space-y-0">
              {incident.status_history.map((sh, i) => (
                <div key={i} className="flex gap-3 pb-3 last:pb-0">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-brand-500 mt-1.5" />
                    {i < incident.status_history.length - 1 && (
                      <div className="w-px flex-1 bg-surface-700 mt-1" />
                    )}
                  </div>
                  <div className="pb-2">
                    <p className="text-xs text-surface-300">
                      <span className="text-surface-500">{sh.old_status}</span>
                      {' → '}
                      <span className="font-medium">{statusLabel[sh.new_status] || sh.new_status}</span>
                    </p>
                    <p className="text-[11px] text-surface-500 mt-0.5">
                      {sh.user_name} · {timeAgo(sh.created_at)}
                    </p>
                    {sh.comment && (
                      <p className="text-xs text-surface-400 mt-0.5 italic">«{sh.comment}»</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function Section({
  title, icon: Icon, accent, children,
}: {
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

function getClientTransitions(status: string): string[] {
  const map: Record<string, string[]> = {
    new: ['in_progress'],
    in_progress: ['awaiting_soc', 'resolved'],
    awaiting_customer: ['in_progress'],
    resolved: ['closed'],
  };
  return map[status] || [];
}
