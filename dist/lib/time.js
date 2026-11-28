"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riyadhDayRange = riyadhDayRange;
exports.riyadhMonthRange = riyadhMonthRange;
// Asia/Riyadh is UTC+3 all year (no DST).
const OFFSET_MS = 3 * 3600 * 1000;
function riyadhDayRange(now = new Date()) {
    const local = new Date(now.getTime() + OFFSET_MS);
    const startUtcMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_MS;
    return { start: new Date(startUtcMs), end: new Date(startUtcMs + 86400000) };
}
function riyadhMonthRange(now = new Date()) {
    const local = new Date(now.getTime() + OFFSET_MS);
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    return { start: new Date(Date.UTC(y, m, 1) - OFFSET_MS), end: new Date(Date.UTC(y, m + 1, 1) - OFFSET_MS) };
}
