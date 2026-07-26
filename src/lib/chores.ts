import type { AppState, Chore, ChoreStatus, Person, StatusFilter } from '../types'
import { nextDueDate, today, type DateString } from './dates'

export interface ChoreDraft {
  title: string
  notes: string
  assigneeId: string | null
  dueDate: DateString | null
  recurrence: Chore['recurrence']
}

export type Action =
  | { type: 'chore/add'; draft: ChoreDraft }
  | { type: 'chore/update'; id: string; draft: ChoreDraft }
  | { type: 'chore/remove'; id: string }
  | { type: 'chore/complete'; id: string }
  | { type: 'chore/undo'; id: string }
  | { type: 'person/add'; name: string }
  | { type: 'person/rename'; id: string; name: string }
  | { type: 'person/remove'; id: string }
  | { type: 'state/replace'; state: AppState }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'chore/add': {
      const chore: Chore = {
        id: createId(),
        ...normalizeDraft(action.draft),
        completedAt: null,
        history: [],
        createdAt: new Date().toISOString(),
      }
      return { ...state, chores: [...state.chores, chore] }
    }

    case 'chore/update':
      return mapChore(state, action.id, (chore) => ({
        ...chore,
        ...normalizeDraft(action.draft),
      }))

    case 'chore/remove':
      return { ...state, chores: state.chores.filter((chore) => chore.id !== action.id) }

    case 'chore/complete':
      return mapChore(state, action.id, completeChore)

    case 'chore/undo':
      return mapChore(state, action.id, undoChore)

    case 'person/add': {
      const name = action.name.trim()
      if (!name) return state
      const person: Person = {
        id: createId(),
        name,
        // Cycling by count keeps colors distinct until the palette wraps.
        colorIndex: state.people.length,
      }
      return { ...state, people: [...state.people, person] }
    }

    case 'person/rename': {
      const name = action.name.trim()
      if (!name) return state
      return {
        ...state,
        people: state.people.map((person) =>
          person.id === action.id ? { ...person, name } : person,
        ),
      }
    }

    case 'person/remove':
      return {
        people: state.people.filter((person) => person.id !== action.id),
        // Chores outlive the people assigned to them; they just become unassigned.
        chores: state.chores.map((chore) =>
          chore.assigneeId === action.id ? { ...chore, assigneeId: null } : chore,
        ),
      }

    case 'state/replace':
      return action.state
  }
}

/**
 * Completing a recurring chore rolls it forward to its next occurrence instead
 * of marking it done, so the list always shows what is coming rather than a
 * growing pile of finished copies.
 */
function completeChore(chore: Chore): Chore {
  const at = new Date().toISOString()
  const history = [...chore.history, { at, fromDueDate: chore.dueDate }]

  if (!chore.recurrence) {
    return { ...chore, completedAt: at, history }
  }
  return {
    ...chore,
    completedAt: null,
    dueDate: nextDueDate(chore.dueDate, chore.recurrence),
    history,
  }
}

function undoChore(chore: Chore): Chore {
  const history = chore.history.slice(0, -1)
  const undone = chore.history.at(-1)

  if (!chore.recurrence) {
    return { ...chore, completedAt: null, history }
  }
  // Nothing to roll back to if the history was lost or never recorded.
  if (!undone) return chore
  return { ...chore, completedAt: null, dueDate: undone.fromDueDate, history }
}

function normalizeDraft(draft: ChoreDraft) {
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    assigneeId: draft.assigneeId,
    dueDate: draft.dueDate,
    recurrence: draft.recurrence
      ? { ...draft.recurrence, interval: Math.max(1, Math.round(draft.recurrence.interval)) }
      : null,
  }
}

function mapChore(state: AppState, id: string, update: (chore: Chore) => Chore): AppState {
  return {
    ...state,
    chores: state.chores.map((chore) => (chore.id === id ? update(chore) : chore)),
  }
}

export function statusOf(chore: Chore, now: DateString = today()): ChoreStatus {
  if (chore.completedAt) return 'done'
  if (!chore.dueDate) return 'someday'
  if (chore.dueDate < now) return 'overdue'
  if (chore.dueDate === now) return 'today'
  return 'upcoming'
}

export interface Filters {
  status: StatusFilter
  assigneeId: string | null
  search: string
}

export function matchesFilters(chore: Chore, filters: Filters, now: DateString): boolean {
  const status = statusOf(chore, now)

  if (filters.status === 'open' && status === 'done') return false
  if (filters.status === 'done' && status !== 'done') return false
  if (filters.status === 'overdue' && status !== 'overdue') return false

  if (filters.assigneeId !== null && chore.assigneeId !== filters.assigneeId) return false

  const search = filters.search.trim().toLowerCase()
  if (search) {
    const haystack = `${chore.title} ${chore.notes}`.toLowerCase()
    if (!haystack.includes(search)) return false
  }
  return true
}

const STATUS_ORDER: Record<ChoreStatus, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  someday: 3,
  done: 4,
}

/** Sorts most-urgent first, with finished chores collected at the bottom. */
export function sortChores(chores: Chore[], now: DateString = today()): Chore[] {
  return [...chores].sort((a, b) => {
    const byStatus = STATUS_ORDER[statusOf(a, now)] - STATUS_ORDER[statusOf(b, now)]
    if (byStatus !== 0) return byStatus

    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate < b.dueDate ? -1 : 1
    }
    return a.title.localeCompare(b.title)
  })
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const EMPTY_DRAFT: ChoreDraft = {
  title: '',
  notes: '',
  assigneeId: null,
  dueDate: null,
  recurrence: null,
}

export function draftFrom(chore: Chore): ChoreDraft {
  return {
    title: chore.title,
    notes: chore.notes,
    assigneeId: chore.assigneeId,
    dueDate: chore.dueDate,
    recurrence: chore.recurrence,
  }
}
