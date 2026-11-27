/** Permissions that exist inside every company (tenant). */
export const TENANT_PERMISSIONS = [
  'customers.view',
  'customers.create',
  'customers.update',
  'customers.delete',
  'services.view',
  'services.manage',
  'technicians.view',
  'technicians.manage',
  'bookings.view',
  'bookings.create',
  'bookings.update',
  'bookings.assign',
  'bookings.status',
  'bookings.cancel',
  'bookings.discount',
  'bookings.edit_price',
  'dashboard.view',
  'users.manage',
  'branches.all',
  'finance.view_cost',
  'company.profile.manage',
] as const;

/** Permissions that only the platform operator's own staff can hold. Never granted to a tenant role. */
export const PLATFORM_PERMISSIONS = ['platform.companies.view', 'platform.companies.review', 'platform.sectors.manage'] as const;

export const PERMISSIONS = [...TENANT_PERMISSIONS, ...PLATFORM_PERMISSIONS] as const;
export type Permission = (typeof PERMISSIONS)[number];

const T = [...TENANT_PERMISSIONS] as string[];
const OPS = T.filter((p) => p !== 'users.manage' && p !== 'company.profile.manage');

export const ROLE_DEFS: Record<string, string[]> = {
  'Company Owner': T,
  'System Administrator': T.filter((p) => p !== 'company.profile.manage'),
  'General Manager': OPS,
  'Operations Manager': OPS.filter((p) => p !== 'finance.view_cost'),
  'Customer Service': ['customers.view', 'customers.create', 'customers.update', 'services.view', 'technicians.view', 'bookings.view', 'bookings.create', 'bookings.update', 'bookings.status', 'bookings.cancel'],
  'Booking Agent': ['customers.view', 'customers.create', 'services.view', 'technicians.view', 'bookings.view', 'bookings.create', 'bookings.update'],
  Supervisor: ['customers.view', 'technicians.view', 'bookings.view', 'bookings.assign', 'bookings.status', 'dashboard.view'],
  Technician: [], // technician endpoints (own tasks only) arrive with the mobile phase
  Accountant: ['customers.view', 'bookings.view', 'dashboard.view', 'finance.view_cost'],
  'Quality Officer': ['customers.view', 'bookings.view'],
  Customer: [],
};

export const PLATFORM_ROLE_DEFS: Record<string, string[]> = {
  'Platform Admin': [...PLATFORM_PERMISSIONS],
  'Platform Reviewer': ['platform.companies.view', 'platform.companies.review'],
};
