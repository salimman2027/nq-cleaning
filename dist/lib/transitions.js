"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_STARTED = exports.RELEASES_ASSIGNMENTS = exports.REASON_REQUIRED = exports.STATUSES = void 0;
exports.canTransition = canTransition;
exports.nextStatuses = nextStatuses;
exports.STATUSES = [
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
];
const T = {
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
exports.REASON_REQUIRED = new Set(['cancelled', 'postponed', 'redo', 'paused']);
/** Statuses that free the technicians' time slots. */
exports.RELEASES_ASSIGNMENTS = new Set(['cancelled', 'postponed']);
/** Statuses where the job has not started yet (used for "late" and "unassigned" indicators). */
exports.NOT_STARTED = ['new', 'awaiting_confirmation', 'confirmed', 'awaiting_assignment', 'assigned'];
function canTransition(from, to) {
    return T[from]?.includes(to) ?? false;
}
function nextStatuses(from) {
    return T[from] ?? [];
}
