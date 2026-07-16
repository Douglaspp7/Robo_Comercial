import { bookingSettingsQueries, bookingBlockQueries, appointmentQueries, googleCalendarBlockQueries } from './db.js';

export const DEFAULT_WEEKLY_AVAILABILITY = {
  0: { enabled: false, intervals: [] },
  1: { enabled: true, intervals: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
  2: { enabled: true, intervals: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
  3: { enabled: true, intervals: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
  4: { enabled: true, intervals: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
  5: { enabled: true, intervals: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
  6: { enabled: true, intervals: [{ start: '08:00', end: '12:00' }] },
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function safeJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_WEEKLY_AVAILABILITY));
}

export function normalizeWeeklyAvailability(input) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  for (let day = 0; day <= 6; day++) {
    const raw = source[day] || source[String(day)] || {};
    const intervals = Array.isArray(raw.intervals) ? raw.intervals
      .filter((item) => TIME_RE.test(String(item?.start || '')) && TIME_RE.test(String(item?.end || '')) && item.start < item.end)
      .map((item) => ({ start: item.start, end: item.end }))
      .sort((a, b) => a.start.localeCompare(b.start))
      : [];
    result[day] = { enabled: raw.enabled === true && intervals.length > 0, intervals };
  }
  return result;
}

export function getBookingSettings(tenantId) {
  const row = bookingSettingsQueries.byTenant.get(tenantId);
  if (!row) {
    return {
      weekly: cloneDefaults(),
      min_notice_minutes: 60,
      max_advance_days: 60,
      buffer_minutes: 0,
    };
  }
  return {
    weekly: normalizeWeeklyAvailability(safeJson(row.weekly_json, cloneDefaults())),
    min_notice_minutes: Math.max(0, Number(row.min_notice_minutes) || 0),
    max_advance_days: Math.max(1, Number(row.max_advance_days) || 60),
    buffer_minutes: Math.max(0, Number(row.buffer_minutes) || 0),
  };
}

export function saveBookingSettings(tenantId, input) {
  const settings = {
    weekly: normalizeWeeklyAvailability(input.weekly),
    min_notice_minutes: Math.min(43200, Math.max(0, Number(input.min_notice_minutes) || 0)),
    max_advance_days: Math.min(365, Math.max(1, Number(input.max_advance_days) || 60)),
    buffer_minutes: Math.min(240, Math.max(0, Number(input.buffer_minutes) || 0)),
  };
  bookingSettingsQueries.upsert.run({
    tenant_id: tenantId,
    weekly_json: JSON.stringify(settings.weekly),
    min_notice_minutes: settings.min_notice_minutes,
    max_advance_days: settings.max_advance_days,
    buffer_minutes: settings.buffer_minutes,
  });
  return settings;
}

function minutesOf(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function isoForBrasilia(date, minutes) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00-03:00`).toISOString();
}

function localDateParts(iso) {
  const date = new Date(iso);
  const dateText = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
  const weekdayText = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(date);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayText);
  return { dateText, weekday };
}

export function formatBookingDateTime(iso) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function getAvailableBookingSlots(tenantId, service, dateText, limit = 100) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) return [];
  const noon = new Date(`${dateText}T12:00:00-03:00`);
  if (!Number.isFinite(noon.getTime())) return [];
  const settings = getBookingSettings(tenantId);
  const today = new Date();
  const maxDate = new Date(today.getTime() + settings.max_advance_days * 86400000);
  if (noon < new Date(today.getTime() - 86400000) || noon > maxDate) return [];

  const { weekday } = localDateParts(noon.toISOString());
  const day = settings.weekly[weekday];
  if (!day?.enabled) return [];

  const duration = Math.max(10, Number(service.duration_minutes) || 30);
  const bufferMs = settings.buffer_minutes * 60000;
  const earliest = Date.now() + settings.min_notice_minutes * 60000;
  const slots = [];

  for (const interval of day.intervals) {
    const startMinute = minutesOf(interval.start);
    const endMinute = minutesOf(interval.end);
    for (let minute = startMinute; minute + duration <= endMinute; minute += 30) {
      const startsAt = isoForBrasilia(dateText, minute);
      const startsMs = new Date(startsAt).getTime();
      if (startsMs < earliest) continue;
      const endsAt = new Date(startsMs + duration * 60000).toISOString();
      const blocked = bookingBlockQueries.overlapping.get({
        tenant_id: tenantId,
        starts_at: startsAt,
        ends_at: endsAt,
      });
      if (blocked) continue;
      const googleBusy = googleCalendarBlockQueries.overlapping.get({ tenant_id: tenantId, starts_at: startsAt, ends_at: endsAt });
      if (googleBusy) continue;
      const conflict = appointmentQueries.findConflict.get({
        tenant_id: tenantId,
        starts_at: new Date(startsMs - bufferMs).toISOString(),
        ends_at: new Date(new Date(endsAt).getTime() + bufferMs).toISOString(),
        ignore_id: null,
      });
      if (!conflict) slots.push({ starts_at: startsAt, ends_at: endsAt, label: formatBookingDateTime(startsAt) });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}

export function validateBookingSlot(tenantId, service, startsAt) {
  const parsed = new Date(startsAt);
  if (!Number.isFinite(parsed.getTime())) return { ok: false, reason: 'Horário inválido.' };
  const { dateText } = localDateParts(parsed.toISOString());
  const slot = getAvailableBookingSlots(tenantId, service, dateText)
    .find((item) => item.starts_at === parsed.toISOString());
  return slot ? { ok: true, slot } : { ok: false, reason: 'Este horário está fora da disponibilidade ou acabou de ser ocupado.' };
}
