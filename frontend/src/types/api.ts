// Types miroir de la réponse API Go.

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  tenant_role: "owner" | "member";
  is_superadmin: boolean;
  full_name?: string | null;
}

export interface LoginResponse {
  access_token: string;
  expires_at: string;
  user: User;
}

// --- RBAC ----------------------------------------------------------------

export type Feature = "dashboard" | "devices" | "rules" | "members";
export type PermissionLevel = "none" | "read" | "write";
export type PermissionSet = Partial<Record<Feature, PermissionLevel>>;

export interface FeatureMeta {
  code: Feature;
  label: string;
  description: string;
}

export interface SiteAccess {
  site_id: string;
  site_slug: string;
  site_name: string;
  role_id?: string;
  role_name: string;
  permissions: PermissionSet;
}

export interface MeResponse {
  user: User;
  sites: SiteAccess[];
}

export interface Role {
  id: string;
  name: string;
  description?: string | null;
  permissions: PermissionSet;
  is_system: boolean;
  /** null = rôle tenant-wide (réutilisable sur tous les sites), sinon scope-site */
  site_id?: string | null;
  /** nom du site (résolu côté serveur via JOIN), null si tenant-wide */
  site_name?: string | null;
  created_at: string;
  updated_at: string;
}

/** Affectation d'un user à un site avec son rôle. */
export interface UserMembership {
  site_id: string;
  site_name: string;
  site_slug: string;
  role_id: string;
  role_name: string;
}

export interface UserListItem {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  job_title?: string | null;
  phone?: string | null;
  tenant_role: "owner" | "member";
  is_superadmin: boolean;
  status: "pending" | "active" | "disabled";
  last_login_at?: string | null;
  created_at: string;
}

export interface SiteMember {
  user_id: string;
  email: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  role_id: string;
  role_name: string;
  permissions: PermissionSet;
  added_at: string;
}

export interface AuditEvent {
  id: string;
  actor_id?: string | null;
  actor_email?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  target_name?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Site {
  id: string;
  slug: string;
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone: string;
}

// "floor" est conservé dans le type pour la rétrocompat des données existantes
// en DB, mais n'est plus proposé dans l'UI de création.
export type ZoneKind = "geographic" | "building_group" | "building" | "floor" | "room";

export interface Zone {
  id: string;
  site_id: string;
  parent_zone_id?: string | null;
  slug: string;
  name: string;
  kind: ZoneKind;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  geometry?: unknown;
}

export interface SiteSummary {
  site_id: string;
  devices_total: number;
  rules_total: number;
  alarms_total: number;
  widgets_total: number;
}

export type DeviceType =
  | "environment" | "presence" | "actuator" | "linky" | "meter" | "gateway";
export type DeviceStatus = "provisioned" | "online" | "offline" | "disabled";

export interface Device {
  id: string;
  zone_id: string;
  site_id: string;
  slug: string;
  name?: string | null;
  type: DeviceType;
  category?: string | null;
  model?: string | null;
  model_id?: string | null;
  status: DeviceStatus;
  last_seen_at?: string | null;
  installed_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DeviceListItem extends Device {
  zone_slug: string;
  zone_name: string;
}

export interface DeviceCreated {
  device: Device;
  mqtt_username: string;
  mqtt_password: string; // affiché une seule fois
}

export interface MeasurementMeta {
  measurement: string;
  unit: string;
  min_value?: number | null;
  max_value?: number | null;
  description?: string | null;
}

// ---------------- Catalogue de modèles ----------------

export interface DeviceModelAttribute {
  id: string;
  name: string;
  unit: string;
  min_value?: number | null;
  max_value?: number | null;
  description?: string | null;
  position: number;
  configurable: boolean;
}

export interface DeviceModel {
  id: string;
  brand: string;
  code: string;
  category: string;
  protocol?: string | null;
  description?: string | null;
  default_interval_minutes?: number | null;
  attributes?: DeviceModelAttribute[];
  created_at: string;
  updated_at: string;
}

export interface CreateDeviceInput {
  zone_id: string;
  type?: DeviceType;
  slug: string;
  name?: string;
  model?: string;
  category?: string;
  model_id?: string;
  measurements?: string[];
  metadata?: Record<string, unknown>;
}

export type ExternalVendor = "iotsens" | "milesight" | "kerlink" | "manual";

export interface ExternalIntegration {
  vendor: ExternalVendor;
  external_id: string;     // ID du device chez le constructeur
  interval_s?: number;     // période de polling souhaitée
  decoder?: string;        // mapping payload (futur)
}

export interface Dashboard {
  id: string;
  site_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardListItem extends Dashboard {
  widget_count: number;
}

export type WidgetType = "value" | "line" | "area" | "bar" | "gauge" | "state" | "map";

export interface WidgetLayout {
  x?: number; y?: number; w?: number; h?: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  position: number;
  config: Record<string, unknown>;
  layout: WidgetLayout; // {} si défaut
  created_at: string;
}

export interface DashboardDetail extends Dashboard {
  widgets: Widget[];
}

export interface CreateWidgetInput {
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
}

// ---------------- Rules ----------------

export type TriggerType = "threshold" | "value_change" | "cron" | "aggregate" | "anomaly";
export type CmpOp = ">" | ">=" | "<" | "<=" | "==" | "!=";
export type AggregateOp = "avg" | "sum" | "min" | "max" | "count";

export interface RuleZoneScope {
  zone_id: string;
  device_type?: string;
}

export interface RuleAggregateSpec {
  op: AggregateOp;
  window_minutes: number;
}

export interface RuleAnomalySpec {
  baseline_days: number;
  sigma: number;
}

export interface RuleTrigger {
  type: TriggerType;
  device_slug?: string;
  measurement?: string;
  op?: CmpOp;
  value?: number;
  sustained_seconds?: number;
  from?: number;
  to?: number;
  schedule?: string;
  zone_scope?: RuleZoneScope;
  aggregate?: RuleAggregateSpec;
  anomaly?: RuleAnomalySpec;
}

export interface RuleCondition {
  device_slug: string;
  measurement: string;
  op: CmpOp;
  value: number;
}

export type AlarmSeverity = "minor" | "major" | "critical";
export type AlarmState = "triggered" | "acknowledged" | "resolved" | "archived";

export type RuleAction =
  | { type: "set_actuator"; device_slug: string; state: string }
  | { type: "notify"; level?: "info" | "warning" | "critical"; message: string }
  | { type: "email"; recipients: string[]; subject: string; message: string; level?: "info" | "warning" | "critical" }
  | { type: "sms"; recipients: string[]; message: string; level?: "info" | "warning" | "critical" }
  | {
      type: "webhook";
      url: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      headers?: Record<string, string>;
      body?: string;
      level?: "info" | "warning" | "critical";
    }
  | {
      type: "alarm";
      severity?: AlarmSeverity;
      label?: string;
      name: string;
      description?: string;
      model?: string;
      status_text?: string;
    };

export interface RuleTimeWindow {
  /** 0=dimanche, 1=lundi, …, 6=samedi. Vide = tous les jours. */
  days?: number[];
  /** Heure de début locale (0-24). */
  start_hour?: number;
  end_hour?: number;
  /** Nom IANA, ex. "Africa/Ouagadougou". Vide = UTC. */
  timezone?: string;
}

export interface RuleDefinition {
  trigger: RuleTrigger;
  conditions_op?: "AND" | "OR";
  conditions?: RuleCondition[];
  actions: RuleAction[];
  cooldown_seconds?: number;
  /**
   * "edge" (défaut, recommandé) : la règle déclenche une seule fois quand la
   * condition devient vraie, puis attend le retour à la normale pour pouvoir
   * re-déclencher. Auto-résolution des alarmes au retour normal.
   *
   * "level" (legacy) : déclenche tant que la condition est vraie, dans la
   * limite de cooldown_seconds.
   */
  retrigger_mode?: "edge" | "level";
  time_window?: RuleTimeWindow;
}

export interface Rule {
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  definition: RuleDefinition;
  created_at: string;
  updated_at: string;
}

export interface RuleExecution {
  id: string;
  rule_id: string;
  triggered_at: string;
  action_taken: unknown;
  result: "success" | "partial" | "failure" | "skipped";
  error_message?: string | null;
  latency_ms: number;
}

// ---------------- Alarmes ----------------

export interface Alarm {
  id: string;
  tenant_id: string;
  site_id: string;
  rule_id: string;
  rule_name: string;
  device_id?: string | null;
  device_slug?: string | null;
  device_name?: string | null;
  zone_id?: string | null;
  zone_name?: string | null;
  label: string;
  name: string;
  description?: string | null;
  severity: AlarmSeverity;
  model: string;
  status_text?: string | null;
  state: AlarmState;
  attribute?: string | null;
  trigger_count: number;
  last_value?: number | null;
  unit?: string | null;
  opened_at: string;
  last_triggered_at: string;
  acked_at?: string | null;
  resolved_at?: string | null;
  archived_at?: string | null;
  ack_user_email?: string | null;
  resolve_user_email?: string | null;
}

export interface AlarmEvent {
  id: string;
  alarm_id: string;
  ts: string;
  state: AlarmState;
  severity: AlarmSeverity;
  description?: string | null;
  trigger_count?: number | null;
  value?: number | null;
  user_email?: string | null;
}

export interface AlarmComment {
  id: string;
  alarm_id: string;
  user_email?: string | null;
  body: string;
  created_at: string;
}

export interface AlarmCounts {
  triggered: number;
  acknowledged: number;
  resolved: number;
  archived: number;
  active: number;
  all: number;
}

export interface Zone {
  id: string;
  slug: string;
  name: string;
  devices: Device[];
}

export interface SiteTree extends Site {
  zones: Zone[];
}

export interface LatestReading {
  measurement: string;
  ts: string;
  value: number;
  quality: string;
}

export interface SeriesPoint {
  ts: string;
  value: number;
  min?: number | null;
  max?: number | null;
}

export interface Series {
  measurement: string;
  aggregation: string;
  from: string;
  to: string;
  points: SeriesPoint[];
}

export type WSEnvelope =
  | { type: "welcome"; tenant_id: string; role: string; server_ts: string }
  | {
      type: "measurement";
      topic: string; ts: string;
      tenant: string; site: string; zone: string; device: string;
      measurement: string; value: number; quality: string;
    }
  | {
      type: "state";
      topic: string; ts: string;
      tenant: string; site: string; zone: string; device: string;
      state: unknown; cmd_id?: string;
    };

export interface CommandResponse {
  command_id: string;
  topic: string;
  issued_at: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
