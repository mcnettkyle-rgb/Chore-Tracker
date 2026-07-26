import type { AppState, Chore, Person, Recurrence } from '../types'
import { isDateString } from './dates'

const STORAGE_KEY = 'chore-tracker/v1'

export const EMPTY_STATE: AppState = { chores: [], people: [] }

/**
 * Reads saved state, discarding anything that does not match the current shape.
 *
 * The store is a browser localStorage entry, which means it can be hand-edited,
 * left behind by an older version of the app, or corrupted by a half-finished
 * write. Every field is checked on the way in so a single bad record degrades to
 * "that chore is gone" instead of a blank screen on load.
 */
export function loadState(storage: Storage = localStorage): AppState {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    // Private-browsing modes and blocked third-party storage throw on access.
    return EMPTY_STATE
  }
  if (!raw) return EMPTY_STATE

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_STATE
  }
  if (!isRecord(parsed)) return EMPTY_STATE

  const people = asArray(parsed.people).map(parsePerson).filter(isPresent)
  const knownPeople = new Set(people.map((person) => person.id))
  const chores = asArray(parsed.chores)
    .map(parseChore)
    .filter(isPresent)
    // An assignee pointing at a deleted person would render as a blank chip.
    .map((chore) =>
      chore.assigneeId && !knownPeople.has(chore.assigneeId)
        ? { ...chore, assigneeId: null }
        : chore,
    )

  return { chores, people }
}

export function saveState(state: AppState, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota exhaustion or blocked storage: the in-memory state is still correct
    // for this session, and failing the write is better than crashing the app.
  }
}

function parsePerson(value: unknown): Person | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.name !== 'string') return null
  const colorIndex = typeof value.colorIndex === 'number' ? value.colorIndex : 0
  return { id: value.id, name: value.name, colorIndex: Math.max(0, Math.floor(colorIndex)) }
}

function parseChore(value: unknown): Chore | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.title !== 'string' || !value.title.trim()) return null

  const history = asArray(value.history)
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.at !== 'string') return null
      return {
        at: entry.at,
        fromDueDate: isDateString(entry.fromDueDate) ? entry.fromDueDate : null,
      }
    })
    .filter(isPresent)

  return {
    id: value.id,
    title: value.title,
    notes: typeof value.notes === 'string' ? value.notes : '',
    assigneeId: typeof value.assigneeId === 'string' ? value.assigneeId : null,
    dueDate: isDateString(value.dueDate) ? value.dueDate : null,
    recurrence: parseRecurrence(value.recurrence),
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
    history,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
  }
}

function parseRecurrence(value: unknown): Recurrence | null {
  if (!isRecord(value)) return null
  if (value.unit !== 'day' && value.unit !== 'week' && value.unit !== 'month') return null
  const interval = typeof value.interval === 'number' ? Math.round(value.interval) : 1
  return { unit: value.unit, interval: Math.max(1, interval) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}
