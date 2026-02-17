import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellOff, Check, CheckCheck, AlertTriangle,
  MessageSquare, ArrowRightLeft,
} from 'lucide-react';
import api from '../services/api';
import { timeAgo } from '../utils';
import type { Notification } from '../types';

const typeIcons: Record<string, React.ElementType> = {
  new_incident: AlertTriangle,
  status_change: ArrowRightLeft,
  soc_comment: MessageSquare,
  client_comment: MessageSquare,
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetch = async () => {
    try {
      const params: Record<string, unknown> = { per_page: 50 };
      if (filter === 'unread') params.read = false;
      const { data } = await api.get('/notifications/', { params });
      setNotifications(data.items || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetch();
  }, [filter]);

  const markRead = async (id: string) => {
    await api.put(`/notifications/${id}/read`);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  };

  const markAllRead = async () => {
    await api.put('/notifications/read-all');
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const handleClick = (n: Notification) => {
    if (!n.is_read) markRead(n.id);
    const incidentId = (n.metadata as any)?.incident_id;
    if (incidentId) navigate(`/incidents/${incidentId}`);
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-5 animate-in max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">Уведомления</h1>
          <p className="text-sm text-surface-500 mt-1">
            {unreadCount > 0 ? `${unreadCount} непрочитанных` : 'Всё прочитано'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="input w-auto"
          >
            <option value="all">Все</option>
            <option value="unread">Непрочитанные</option>
          </select>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="btn-secondary text-sm flex items-center gap-1.5">
              <CheckCheck className="w-4 h-4" />
              Прочитать все
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-4 h-16 animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="card p-16 text-center">
          <BellOff className="w-10 h-10 text-surface-700 mx-auto mb-3" />
          <p className="text-surface-400">Нет уведомлений</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {notifications.map((n) => {
            const Icon = typeIcons[n.type] || Bell;
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left card p-4 flex items-start gap-3 hover:border-surface-700 transition-colors ${
                  !n.is_read ? 'border-brand-600/20 bg-brand-600/[0.02]' : ''
                }`}
              >
                <div className={`mt-0.5 ${!n.is_read ? 'text-brand-400' : 'text-surface-600'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium truncate ${!n.is_read ? 'text-surface-100' : 'text-surface-400'}`}>
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-surface-500 truncate mt-0.5">{n.message}</p>
                </div>
                <span className="text-xs text-surface-600 shrink-0 mt-0.5">{timeAgo(n.created_at)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
