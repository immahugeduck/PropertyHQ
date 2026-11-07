export interface Property {
  id: string
  user_id: string
  owner_id: string | null
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  property_type: 'apartment' | 'house' | 'condo' | 'townhouse' | 'commercial'
  bedrooms: number
  bathrooms: number
  square_feet: number | null
  monthly_rent: number
  status: 'vacant' | 'occupied' | 'maintenance'
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Tenant {
  is_demo?: boolean
  rent_due_day?: number
  id: string
  user_id: string
  property_id: string | null
  first_name: string
  last_name: string
  email: string
  phone: string | null
  lease_start: string | null
  lease_end: string | null
  rent_amount: number
  security_deposit: number
  status: 'active' | 'inactive' | 'pending'
  notes: string | null
  auth_user_id: string | null
  portal_enabled: boolean
  invited_at: string | null
  portal_activated_at: string | null
  /** Normalized copy of `phone` (+1XXXXXXXXXX), maintained by the database. */
  phone_e164?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  emergency_contact_relationship?: string | null
  created_at: string
  updated_at: string
  property?: Property | null
}

/** Someone 12 or older living in a tenant's unit. */
export interface HouseholdMember {
  id: string
  user_id: string
  tenant_id: string
  full_name: string
  relationship: string | null
  is_minor: boolean
  phone: string | null
  added_by: 'tenant' | 'manager'
  created_at: string
  updated_at: string
}

export interface TenantInvite {
  id: string
  user_id: string
  tenant_id: string
  email: string
  token: string
  status: 'pending' | 'accepted' | 'expired'
  expires_at: string
  accepted_at: string | null
  created_at: string
  tenant?: Tenant
}

export interface RentSchedule {
  id: string
  user_id: string
  tenant_id: string
  property_id: string | null
  amount: number
  day_of_month: number
  active: boolean
  last_generated_for: string | null
  created_at: string
  updated_at: string
  tenant?: Tenant
  property?: Property
}

export interface PropertyOwner {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  company_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface RentPayment {
  amount_paid?: number
  balance_due?: number
  lease_id?: string | null
  is_demo?: boolean
  id: string
  user_id: string
  tenant_id: string
  property_id: string | null
  amount: number
  due_date: string
  paid_date: string | null
  status: 'pending' | 'paid' | 'overdue' | 'partial'
  payment_method: string | null
  notes: string | null
  is_recurring: boolean
  recurring_day: number | null
  rent_schedule_id: string | null
  stripe_session_id: string | null
  stripe_payment_intent: string | null
  receipt_number: string | null
  created_at: string
  updated_at: string
  tenant?: Tenant
  property?: Property
}

export interface MaintenanceRequest {
  id: string
  user_id: string
  property_id: string
  tenant_id: string | null
  title: string
  description: string
  category: 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'structural' | 'general'
  urgency: 'low' | 'medium' | 'high' | 'emergency'
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  estimated_cost: number | null
  actual_cost: number | null
  scheduled_date: string | null
  completed_date: string | null
  notes: string | null
  photo_paths: string[] | null
  reported_by_name: string | null
  /** Short number staff can reference by text, e.g. "1042 done". */
  job_number?: number
  source?: 'app' | 'sms' | 'voice'
  scheduled_at?: string | null
  /** Set by the database when status becomes 'completed'. */
  completed_at?: string | null
  completion_notified_at?: string | null
  created_at: string
  updated_at: string
  vendor_id?: string | null
  vendor?: Vendor | null
  tenant?: Tenant
  property?: Property
}

export interface Vendor {
  id: string
  user_id: string
  name: string
  company_name: string | null
  specialty: string | null
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface VendorPayment {
  id: string
  user_id: string
  vendor_id: string
  maintenance_request_id: string | null
  amount: number
  date: string
  payment_method: string | null
  reference_number: string | null
  notes: string | null
  created_at: string
  updated_at: string
  vendor?: Vendor
  maintenance_request?: Pick<MaintenanceRequest, 'id' | 'title'> | null
}

export interface Message {
  id: string
  user_id: string
  tenant_id: string
  property_id: string | null
  subject: string
  body: string
  direction: 'inbound' | 'outbound'
  sender_role: 'manager' | 'tenant'
  is_read: boolean
  created_at: string
  attachment_path?: string | null
  attachment_name?: string | null
  attachment_type?: string | null
  attachment_size?: number | null
  /** Short-lived signed URL, populated server-side when a thread is loaded. */
  attachment_url?: string | null
  tenant?: Tenant
  property?: Property
}

export interface Expense {
  id: string
  user_id: string
  property_id: string | null
  category: 'repairs' | 'utilities' | 'insurance' | 'taxes' | 'management' | 'supplies' | 'landscaping' | 'cleaning' | 'other'
  description: string
  amount: number
  date: string
  vendor: string | null
  receipt_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  property?: Property
}

export interface Notification {
  id: string
  user_id: string
  recipient_type: 'manager' | 'tenant'
  type: 'payment_received' | 'payment_due' | 'payment_overdue' | 'maintenance_new' | 'maintenance_updated' | 'maintenance_completed' | 'message_received' | 'lease_expiring' | 'tenant_added' | 'invoice_issued' | 'general'
  title: string
  message: string
  link: string | null
  related_id: string | null
  is_read: boolean
  created_at: string
}

export interface FileFolder {
  id: string
  user_id: string
  name: string
  parent_id: string | null
  created_at: string
  updated_at: string
  children?: FileFolder[]
}

export interface FileRecord {
  id: string
  user_id: string
  folder_id: string | null
  tenant_id: string | null
  property_id: string | null
  owner_id: string | null
  file_name: string
  file_size: number
  mime_type: string | null
  storage_path: string
  is_template: boolean
  description: string | null
  created_at: string
  updated_at: string
  folder?: FileFolder | null
  tenant?: Pick<Tenant, 'id' | 'first_name' | 'last_name'> | null
  property?: Pick<Property, 'id' | 'name'> | null
}

export type LeaseFieldType = 'text' | 'date' | 'number' | 'checkbox' | 'signature' | 'initials'
export type LeaseFieldRole = 'manager' | 'tenant'

/**
 * A single fillable field placed on a lease template. Geometry is in PDF points
 * with a TOP-LEFT origin; `y` is the text baseline (for signatures, the box top).
 * `source` auto-fills the value from existing records when a lease is created.
 */
export interface LeaseTemplateField {
  key: string
  label: string
  type: LeaseFieldType
  role: LeaseFieldRole
  source:
    | null
    | 'manager.name'
    | 'tenant.full'
    | 'tenant.first_name'
    | 'tenant.last_name'
    | 'tenant.email'
    | 'tenant.phone'
    | 'property.address'
    | 'property.city'
    | 'property.state'
  required: boolean
  page: number
  x: number
  y: number
  w: number
  size: number
  h?: number
}

export interface LeaseTemplate {
  id: string
  user_id: string
  name: string
  description: string | null
  storage_path: string
  page_count: number
  page_sizes: { w: number; h: number }[]
  fields: LeaseTemplateField[]
  created_at: string
  updated_at: string
}

export type LeaseStatus = 'draft' | 'sent' | 'signed' | 'voided'

export interface Lease {
  starts_on?: string | null
  ends_on?: string | null
  monthly_rent?: number | null
  rent_due_day?: number | null
  id: string
  user_id: string
  template_id: string | null
  tenant_id: string | null
  property_id: string | null
  title: string
  status: LeaseStatus
  values: Record<string, string | boolean>
  signed_storage_path: string | null
  signed_file_id: string | null
  signer_name: string | null
  sent_at: string | null
  signed_at: string | null
  created_at: string
  updated_at: string
  template?: LeaseTemplate | null
  tenant?: Tenant | null
  property?: Property | null
}

export interface DashboardStats {
  totalProperties: number
  occupiedProperties: number
  vacantProperties: number
  totalTenants: number
  monthlyRevenue: number
  pendingPayments: number
  overduePayments: number
  openMaintenanceRequests: number
}

/** Settings for the maintenance text/call line (one row per manager). */
export interface TriageSettings {
  user_id: string
  twilio_number: string
  maintenance_phone: string | null
  maintenance_email: string | null
  manager_phone: string | null
  manager_email: string | null
  timezone: string
  open_days: number[]
  open_time: string
  close_time: string
  emergency_reply: string
  created_at: string
  updated_at: string
}

/** One text or call on the maintenance line. Written only by the triage service. */
export interface SmsMessage {
  id: string
  user_id: string
  direction: 'inbound' | 'outbound'
  channel: 'sms' | 'voice'
  party: 'tenant' | 'maintenance' | 'manager' | 'unknown'
  kind: 'message' | 'new_request_alert' | 'emergency_alert' | 'schedule_notice' | 'completion_notice'
  from_number: string
  to_number: string
  body: string
  twilio_sid: string | null
  status: string | null
  error: string | null
  tenant_id: string | null
  maintenance_request_id: string | null
  completed_at: string | null
  created_at: string
}
