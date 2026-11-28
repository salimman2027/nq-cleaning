"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_ROLE_DEFS = exports.ROLE_DEFS = exports.PERMISSIONS = exports.PLATFORM_PERMISSIONS = exports.TENANT_PERMISSIONS = void 0;
/** Permissions that exist inside every company (tenant). */
exports.TENANT_PERMISSIONS = [
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
    'field.work',
];
/** Permissions that only the platform operator's own staff can hold. Never granted to a tenant role. */
exports.PLATFORM_PERMISSIONS = ['platform.companies.view', 'platform.companies.review', 'platform.sectors.manage', 'platform.brand.manage'];
exports.PERMISSIONS = [...exports.TENANT_PERMISSIONS, ...exports.PLATFORM_PERMISSIONS];
const T = [...exports.TENANT_PERMISSIONS];
const OPS = T.filter((p) => p !== 'users.manage' && p !== 'company.profile.manage' && p !== 'field.work');
exports.ROLE_DEFS = {
    'Company Owner': T,
    'System Administrator': T.filter((p) => p !== 'company.profile.manage'),
    'General Manager': OPS,
    'Operations Manager': OPS.filter((p) => p !== 'finance.view_cost'),
    'Customer Service': ['customers.view', 'customers.create', 'customers.update', 'services.view', 'technicians.view', 'bookings.view', 'bookings.create', 'bookings.update', 'bookings.status', 'bookings.cancel'],
    'Booking Agent': ['customers.view', 'customers.create', 'services.view', 'technicians.view', 'bookings.view', 'bookings.create', 'bookings.update'],
    Supervisor: ['customers.view', 'technicians.view', 'bookings.view', 'bookings.assign', 'bookings.status', 'dashboard.view'],
    'Field Supervisor': ['field.work'], // the supervisor's phone app: only their own jobs
    Technician: [], // technician endpoints (own tasks only) arrive with the mobile phase
    Accountant: ['customers.view', 'bookings.view', 'dashboard.view', 'finance.view_cost'],
    'Quality Officer': ['customers.view', 'bookings.view'],
    Customer: [],
};
exports.PLATFORM_ROLE_DEFS = {
    'Platform Admin': [...exports.PLATFORM_PERMISSIONS],
    'Platform Reviewer': ['platform.companies.view', 'platform.companies.review'],
};
