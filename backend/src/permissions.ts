export const PERMISSIONS = [
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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as string[];
const OPS = ALL.filter((p) => p !== 'users.manage');

export const ROLE_DEFS: Record<string, string[]> = {
  'System Administrator': ALL,
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
