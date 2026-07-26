export type RecurrenceUnit = 'day' | 'week' | 'month'

export interface Recurrence {
  unit: RecurrenceUnit
  /** How many units between occurrences, e.g. `{ unit: 'week', interval: 2 }` is fortnightly. */
  interval: number
}

export interface Person {
  id: string
  name: string
  /** Index into the palette in `lib/palette.ts`, so colors survive theme changes. */
  colorIndex: number
}

/**
 * One completion of a chore. `fromDueDate` records the due date the chore had
 * before it was completed, so undoing a completion restores it exactly rather
 * than trying to run the recurrence maths backwards.
 */
export interface Completion {
  at: string
  fromDueDate: string | null
}

export interface Chore {
  id: string
  title: string
  notes: string
  assigneeId: string | null
  /** Local calendar date as `YYYY-MM-DD`, or null for a chore with no deadline. */
  dueDate: string | null
  recurrence: Recurrence | null
  /**
   * Set only for one-off chores. Recurring chores are never "done" — completing
   * one rolls its due date forward instead.
   */
  completedAt: string | null
  history: Completion[]
  createdAt: string
}

export interface AppState {
  chores: Chore[]
  people: Person[]
}

export type ChoreStatus = 'done' | 'overdue' | 'today' | 'upcoming' | 'someday'

export type StatusFilter = 'all' | 'open' | 'overdue' | 'done'
