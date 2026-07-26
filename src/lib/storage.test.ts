import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_STATE, loadState, saveState } from './storage'
import type { AppState } from '../types'

/** Minimal in-memory stand-in for `localStorage`. */
function createStorage(initial?: string): Storage {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set('chore-tracker/v1', initial)
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

const state: AppState = {
  people: [{ id: 'p1', name: 'Sam', colorIndex: 0 }],
  chores: [
    {
      id: 'c1',
      title: 'Water the plants',
      notes: 'not the cactus',
      assigneeId: 'p1',
      dueDate: '2026-07-26',
      recurrence: { unit: 'week', interval: 1 },
      completedAt: null,
      history: [{ at: '2026-07-19T09:00:00.000Z', fromDueDate: '2026-07-19' }],
      createdAt: '2026-07-01T09:00:00.000Z',
    },
  ],
}

describe('round trip', () => {
  it('restores what it saved', () => {
    const storage = createStorage()
    saveState(state, storage)
    expect(loadState(storage)).toEqual(state)
  })
})

describe('loadState with unusable data', () => {
  it.each([
    ['nothing stored', undefined],
    ['invalid JSON', '{not json'],
    ['a JSON array', '[]'],
    ['a JSON scalar', '42'],
  ])('returns empty state for %s', (_label, raw) => {
    expect(loadState(createStorage(raw))).toEqual(EMPTY_STATE)
  })

  it('survives storage that throws on access', () => {
    const hostile = {
      getItem() {
        throw new DOMException('denied')
      },
    } as unknown as Storage
    expect(loadState(hostile)).toEqual(EMPTY_STATE)
  })
})

describe('loadState field validation', () => {
  it('drops chores missing an id or title', () => {
    const raw = JSON.stringify({
      people: [],
      chores: [{ title: 'no id' }, { id: 'c1' }, { id: 'c2', title: '   ' }],
    })
    expect(loadState(createStorage(raw)).chores).toEqual([])
  })

  it('discards a malformed due date rather than the whole chore', () => {
    const raw = JSON.stringify({
      people: [],
      chores: [{ id: 'c1', title: 'Dishes', dueDate: 'next tuesday' }],
    })
    const loaded = loadState(createStorage(raw))
    expect(loaded.chores).toHaveLength(1)
    expect(loaded.chores[0].dueDate).toBeNull()
  })

  it('rejects a recurrence with an unknown unit', () => {
    const raw = JSON.stringify({
      people: [],
      chores: [{ id: 'c1', title: 'Dishes', recurrence: { unit: 'fortnight', interval: 1 } }],
    })
    expect(loadState(createStorage(raw)).chores[0].recurrence).toBeNull()
  })

  it('clears an assignee that no longer exists', () => {
    const raw = JSON.stringify({
      people: [],
      chores: [{ id: 'c1', title: 'Dishes', assigneeId: 'ghost' }],
    })
    expect(loadState(createStorage(raw)).chores[0].assigneeId).toBeNull()
  })

  it('fills in defaults for absent optional fields', () => {
    const raw = JSON.stringify({ people: [], chores: [{ id: 'c1', title: 'Dishes' }] })
    const chore = loadState(createStorage(raw)).chores[0]
    expect(chore.notes).toBe('')
    expect(chore.history).toEqual([])
    expect(chore.createdAt).toEqual(expect.any(String))
  })
})

describe('saveState', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createStorage()
  })

  it('does not throw when the quota is exhausted', () => {
    const full = {
      ...storage,
      setItem() {
        throw new DOMException('QuotaExceededError')
      },
    } as unknown as Storage
    expect(() => saveState(state, full)).not.toThrow()
  })
})
