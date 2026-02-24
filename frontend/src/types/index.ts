// ── Auth ──────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  requires_mfa: boolean;
  temp_token?: string;
  access_token?: string;
  refresh_token?: string;
}

export interface MFAVerifyRequest {
  temp_token: string;
  totp_code: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string | null;
  mfa_enabled: boolean;
}

// ── Incidents ────────────────────────────────────────────────────

export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'new' | 'in_progress' | 'awaiting_customer' | 'awaiting_soc' | 'resolved' | 'closed' | 'false_positive';

export interface IncidentListItem {
  id: string;
  rusiem_incident_id: number;
  title: string;
  priority: Priority;
  status: IncidentStatus;
  category: string | null;
  published_at: string;
  updated_at: string;
  comments_count: number;
}

export interface IncidentComment {
  id: string;
  user_name: string;
  text: string;
  is_soc: boolean;
  created_at: string;
}

export interface StatusChange {
  old_status: string;
  new_status: string;
  user_name: string;
  comment: string | null;
  created_at: string;
}

export interface IncidentDetail {
  id: string;
  tenant_id: string;
  rusiem_incident_id: number;
  title: string;
  description: string | null;
  priority: Priority;
  category: string | null;
  mitre_id: string | null;
  source_ips: string[];
  source_hostnames: string[];
  event_source_ips: string[];
  event_count: number;
  symptoms: string[];
  rusiem_created_at: string | null;
  status: IncidentStatus;
  recommendations: string | null;
  soc_actions: string | null;
  client_response: string | null;
  ioc_indicators: IOCIndicator[];
  affected_assets: AffectedAsset[];
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  published_by_name: string;
  published_at: string;
  closed_by_name: string | null;
  closed_at: string | null;
  comments: IncidentComment[];
  status_history: StatusChange[];
}

export interface IOCIndicator {
  type: string;   // ip, domain, hash, url, email
  value: string;
  context?: string;
}

export interface AffectedAsset {
  name: string;
  type: string;   // server, workstation, network, user_account
  ip?: string;
  criticality?: string;  // critical, high, medium, low
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

// ── Dashboard ────────────────────────────────────────────────────

export interface DashboardSummary {
  incidents: {
    total: number;
    open: number;
    by_priority: Record<Priority, number>;
    by_status: Record<string, number>;
  };
  sla: {
    mtta_minutes: number | null;
    mttr_minutes: number | null;
    compliance_pct: number | null;
  };
  sources: {
    total: number;
    active: number;
    degraded: number;
    no_logs: number;
    error: number;
  };
  top_categories: { category: string; count: number; open: number }[];
}

export interface ChartDataPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// ── Sources ──────────────────────────────────────────────────────

export interface LogSource {
  id: string;
  name: string;
  source_type: string;
  host: string;
  vendor: string | null;
  product: string | null;
  rusiem_group_name: string | null;
  status: string;
  last_event_at: string | null;
  eps: number | null;
  created_at: string | null;
}

// ── Notifications ────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  extra_data: Record<string, unknown> | null;
  created_at: string;
}

// ── SOC ──────────────────────────────────────────────────────────

export interface IncidentPreview {
  rusiem_incident_id: number;
  title: string;
  description: string | null;
  priority: string;
  priority_num: number;
  category: string | null;
  mitre_id: string | null;
  source_ips: string[];
  source_hostnames: string[];
  event_source_ips: string[];
  event_count: number;
  symptoms: string[];
  rusiem_status: string;
  created_at: string | null;
}

export interface PublishRequest {
  rusiem_incident_id: number;
  tenant_id: string;
  recommendations: string;
  soc_actions?: string;
}

export interface Tenant {
  id: string;
  name: string;
  short_name: string;
}
