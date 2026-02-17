import { formatDistanceToNow, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function timeAgo(date: string | null): string {
  if (!date) return '—';
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru });
}

export function formatDate(date: string | null): string {
  if (!date) return '—';
  return format(new Date(date), 'dd.MM.yyyy HH:mm');
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} ч`;
  return `${(minutes / 1440).toFixed(1)} д`;
}

export const priorityLabel: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const statusLabel: Record<string, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  awaiting_customer: 'Ожидает клиента',
  awaiting_soc: 'Ожидает SOC',
  resolved: 'Решён',
  closed: 'Закрыт',
  false_positive: 'Ложное',
};

export const statusBadgeClass: Record<string, string> = {
  new: 'badge-new',
  in_progress: 'badge-in_progress',
  awaiting_customer: 'badge-awaiting',
  awaiting_soc: 'badge-awaiting',
  resolved: 'badge-resolved',
  closed: 'badge-closed',
  false_positive: 'badge-closed',
};

export const priorityBadgeClass: Record<string, string> = {
  critical: 'badge-critical',
  high: 'badge-high',
  medium: 'badge-medium',
  low: 'badge-low',
};
