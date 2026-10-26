import { ApiClient } from './api';

export interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface Inbox {
  items: InboxItem[];
  unread: number;
  total: number;
}

export const getInbox = (api: ApiClient) => api.request<Inbox>('/me/notifications');
export const markAllRead = (api: ApiClient) =>
  api.request<void>('/me/notifications/read-all', { method: 'POST' });

/** "5 min ago" style label for an inbox timestamp. */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
