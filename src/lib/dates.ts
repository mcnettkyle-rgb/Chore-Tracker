import type { Recurrence } from '../types'

/**
 * Dates are handled as `YYYY-MM-DD` strings in the user's local calendar rather
 * than `Date` objects or UTC timestamps. A chore due "today" should mean today
 * where the user is standing, and parsing `2026-07-26` with `new Date()` gives
 * UTC midnight, which lands on the previous day for anyone west of Greenwich.
 */
export type DateString = string

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isDateString(value: unknown): value is DateString {
  return typeof value === 'string' && DATE_PATTERN.test(value)
}

export function today(now: Date = new Date()): DateString {
  return toDateString(now)
}

export function toDateString(date: Date): DateString {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parses a `YYYY-MM-DD` string into a local-midnight `Date`. */
export function parseDateString(value: DateString): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(value: DateString, days: number): DateString {
  const date = parseDateString(value)
  date.setDate(date.getDate() + days)
  return toDateString(date)
}

/**
 * Adds whole months, clamping to the end of the target month so that
 * `2026-01-31` plus one month is `2026-02-28` rather than spilling into March.
 */
export function addMonths(value: DateString, months: number): DateString {
  const date = parseDateString(value)
  const targetDay = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const daysInTargetMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(targetDay, daysInTargetMonth))
  return toDateString(date)
}

export function advance(value: DateString, recurrence: Recurrence): DateString {
  const interval = Math.max(1, Math.round(recurrence.interval))
  switch (recurrence.unit) {
    case 'day':
      return addDays(value, interval)
    case 'week':
      return addDays(value, interval * 7)
    case 'month':
      return addMonths(value, interval)
  }
}

/**
 * The due date a recurring chore takes on once it has been completed.
 *
 * Advancing repeatedly from the old due date (rather than just adding one
 * interval to today) keeps a weekly chore anchored to its day of the week even
 * when it is completed late. The loop skips over occurrences that were missed
 * entirely, so a daily chore left for a month comes back due tomorrow instead
 * of thirty times over.
 */
export function nextDueDate(
  current: DateString | null,
  recurrence: Recurrence,
  now: DateString = today(),
): DateString {
  let next = advance(current ?? now, recurrence)
  // Bounded to keep a pathological interval from spinning: 1000 steps covers
  // more than a century of monthly recurrence.
  for (let i = 0; i < 1000 && next <= now; i += 1) {
    next = advance(next, recurrence)
  }
  return next
}

export function daysBetween(from: DateString, to: DateString): number {
  const millisPerDay = 24 * 60 * 60 * 1000
  const diff = parseDateString(to).getTime() - parseDateString(from).getTime()
  return Math.round(diff / millisPerDay)
}

/** Renders a due date the way a person would say it: "Today", "in 3 days", "Mar 4". */
export function formatDueDate(value: DateString, now: DateString = today()): string {
  const delta = daysBetween(now, value)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  if (delta > 1 && delta <= 6) return `in ${delta} days`
  if (delta < -1 && delta >= -6) return `${Math.abs(delta)} days ago`

  const date = parseDateString(value)
  const sameYear = date.getFullYear() === parseDateString(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function describeRecurrence(recurrence: Recurrence): string {
  const interval = Math.max(1, Math.round(recurrence.interval))
  if (interval === 1) {
    return { day: 'Daily', week: 'Weekly', month: 'Monthly' }[recurrence.unit]
  }
  return `Every ${interval} ${recurrence.unit}s`
}
