export const STATUSES = [
  'new',
  'awaiting_confirmation',
  'confirmed',
  'awaiting_assignment',
  'assigned',
  'on_the_way',
  'arrived',
  'in_progress',
  'paused',
  'awaiting_review',
  'done',
  'closed',
  'postponed',
  'cancelled',
  'redo',
] as const;

export type BookingStatus = (typeof STATUSES)[number];

const T: Record<BookingStatus, BookingStatus[]> = {
  new: ['awaiting_confirmation', 'confirmed', 'cancelled', 'postponed'],
  awaiting_confirmation: ['confirmed', 'cancelled', 'postponed'],
  confirmed: ['awaiting_assignment', 'assigned', 'cancelled', 'postponed'],
  awaiting_assignment: ['assigned', 'cancelled', 'postponed'],
  assigned: ['on_the_way', 'awaiting_assignment', 'cancelled', 'postponed'],
  on_the_way: ['arrived', 'cancelled'],
  arrived: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'awaiting_review'],
  paused: ['in_progress', 'cancelled'],
  awaiting_review: ['done', 'redo', 'in_progress'],
  done: ['closed', 'redo'],
  redo: ['assigned', 'awaiting_assignment', 'cancelled'],
  postponed: ['confirmed', 'awaiting_assignment', 'cancelled'],
  closed: [],
  cancelled: [],
};

export const REASON_REQUIRED: ReadonlySet<BookingStatus> = new Set(['cancelled', 'postponed', 'redo', 'paused']);
/** Statuses that free the technicians' time slots. */
export const RELEASES_ASSIGNMENTS: ReadonlySet<BookingStatus> = new Set(['cancelled', 'postponed']);
/** Statuses where the job has not started yet (used for "late" and "unassigned" indicators). */
export const NOT_STARTED = ['new', 'awaiting_confirmation', 'confirmed', 'awaiting_assignment', 'assigned'] as const;

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return T[from]?.includes(to) ?? false;
}

export function nextStatuses(from: BookingStatus): BookingStatus[] {
  return T[from] ?? [];
}
