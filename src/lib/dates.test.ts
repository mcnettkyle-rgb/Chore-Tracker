import { describe, expect, it } from 'vitest'
import { addMonths, daysBetween, formatDueDate, nextDueDate, toDateString } from './dates'

describe('toDateString', () => {
  it('uses the local calendar day, not UTC', () => {
    // Late-evening local time is already the next day in UTC.
    expect(toDateString(new Date(2026, 6, 26, 23, 30))).toBe('2026-07-26')
    expect(toDateString(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01')
  })

  it('zero-pads month and day', () => {
    expect(toDateString(new Date(2026, 2, 4))).toBe('2026-03-04')
  })
})

describe('addMonths', () => {
  it('clamps to the end of a shorter target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('rolls over the year boundary', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })
})

describe('nextDueDate', () => {
  it('advances one interval when the chore is done on time', () => {
    expect(nextDueDate('2026-07-26', { unit: 'week', interval: 1 }, '2026-07-26')).toBe(
      '2026-08-02',
    )
  })

  it('keeps a weekly chore on its original weekday when completed late', () => {
    // Due Monday, actually done that Wednesday: next is still a Monday.
    const next = nextDueDate('2026-07-20', { unit: 'week', interval: 1 }, '2026-07-22')
    expect(next).toBe('2026-07-27')
  })

  it('skips missed occurrences instead of piling them up', () => {
    // A daily chore ignored for a month comes back due tomorrow, once.
    expect(nextDueDate('2026-06-01', { unit: 'day', interval: 1 }, '2026-07-26')).toBe(
      '2026-07-27',
    )
  })

  it('respects multi-unit intervals', () => {
    expect(nextDueDate('2026-07-26', { unit: 'week', interval: 2 }, '2026-07-26')).toBe(
      '2026-08-09',
    )
    expect(nextDueDate('2026-07-26', { unit: 'month', interval: 3 }, '2026-07-26')).toBe(
      '2026-10-26',
    )
  })

  it('anchors to today when the chore has no due date', () => {
    expect(nextDueDate(null, { unit: 'day', interval: 1 }, '2026-07-26')).toBe('2026-07-27')
  })

  it('always returns a date strictly after today', () => {
    const next = nextDueDate('2026-07-26', { unit: 'day', interval: 1 }, '2026-07-26')
    expect(next > '2026-07-26').toBe(true)
  })
})

describe('daysBetween', () => {
  it('counts whole days across a DST boundary', () => {
    // Spring-forward in most of the US: the interval is 23 hours, still one day.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })

  it('is negative when the target is in the past', () => {
    expect(daysBetween('2026-07-26', '2026-07-24')).toBe(-2)
  })
})

describe('formatDueDate', () => {
  it('uses relative wording near today', () => {
    expect(formatDueDate('2026-07-26', '2026-07-26')).toBe('Today')
    expect(formatDueDate('2026-07-27', '2026-07-26')).toBe('Tomorrow')
    expect(formatDueDate('2026-07-25', '2026-07-26')).toBe('Yesterday')
    expect(formatDueDate('2026-07-29', '2026-07-26')).toBe('in 3 days')
    expect(formatDueDate('2026-07-23', '2026-07-26')).toBe('3 days ago')
  })

  it('falls back to a calendar date further out', () => {
    expect(formatDueDate('2026-09-04', '2026-07-26')).toMatch(/Sep/)
  })
})
