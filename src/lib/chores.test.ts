import { describe, expect, it } from 'vitest'
import { matchesFilters, reducer, sortChores, statusOf, type ChoreDraft } from './chores'
import { today } from './dates'
import type { AppState, Chore } from '../types'

const EMPTY: AppState = { chores: [], people: [] }

function draft(overrides: Partial<ChoreDraft> = {}): ChoreDraft {
  return {
    title: 'Wash up',
    notes: '',
    assigneeId: null,
    dueDate: null,
    recurrence: null,
    ...overrides,
  }
}

function withChore(overrides: Partial<ChoreDraft> = {}): [AppState, Chore] {
  const state = reducer(EMPTY, { type: 'chore/add', draft: draft(overrides) })
  return [state, state.chores[0]]
}

describe('adding chores', () => {
  it('trims whitespace and starts uncompleted', () => {
    const [, chore] = withChore({ title: '  Wash up  ', notes: '  after dinner ' })
    expect(chore.title).toBe('Wash up')
    expect(chore.notes).toBe('after dinner')
    expect(chore.completedAt).toBeNull()
    expect(chore.history).toEqual([])
  })

  it('clamps a nonsense repeat interval to at least one', () => {
    const [, chore] = withChore({ recurrence: { unit: 'day', interval: 0 } })
    expect(chore.recurrence).toEqual({ unit: 'day', interval: 1 })
  })
})

describe('completing a one-off chore', () => {
  it('marks it done and records the completion', () => {
    const [state, chore] = withChore({ dueDate: '2026-07-26' })
    const next = reducer(state, { type: 'chore/complete', id: chore.id })
    const done = next.chores[0]

    expect(done.completedAt).not.toBeNull()
    expect(done.dueDate).toBe('2026-07-26')
    expect(done.history).toHaveLength(1)
    expect(statusOf(done)).toBe('done')
  })

  it('restores the open state on undo', () => {
    const [state, chore] = withChore()
    const done = reducer(state, { type: 'chore/complete', id: chore.id })
    const undone = reducer(done, { type: 'chore/undo', id: chore.id })

    expect(undone.chores[0].completedAt).toBeNull()
    expect(undone.chores[0].history).toEqual([])
  })
})

describe('completing a recurring chore', () => {
  it('rolls the due date forward instead of marking it done', () => {
    const [state, chore] = withChore({
      dueDate: today(),
      recurrence: { unit: 'week', interval: 1 },
    })
    const next = reducer(state, { type: 'chore/complete', id: chore.id })
    const rolled = next.chores[0]

    expect(rolled.completedAt).toBeNull()
    expect(rolled.dueDate! > today()).toBe(true)
    expect(rolled.history).toHaveLength(1)
    expect(statusOf(rolled)).toBe('upcoming')
  })

  it('restores the exact previous due date on undo', () => {
    // Month arithmetic is lossy in reverse (Jan 31 -> Feb 28 -> Mar 28), so undo
    // replays the recorded due date rather than recomputing it.
    const [state, chore] = withChore({
      dueDate: '2026-01-31',
      recurrence: { unit: 'month', interval: 1 },
    })
    const done = reducer(state, { type: 'chore/complete', id: chore.id })
    const undone = reducer(done, { type: 'chore/undo', id: chore.id })

    expect(undone.chores[0].dueDate).toBe('2026-01-31')
    expect(undone.chores[0].history).toEqual([])
  })

  it('undoes only the most recent completion', () => {
    const [state, chore] = withChore({
      dueDate: today(),
      recurrence: { unit: 'day', interval: 1 },
    })
    const twice = [1, 2].reduce(
      (acc) => reducer(acc, { type: 'chore/complete', id: chore.id }),
      state,
    )
    const undone = reducer(twice, { type: 'chore/undo', id: chore.id })

    expect(undone.chores[0].history).toHaveLength(1)
    expect(undone.chores[0].dueDate).toBe(twice.chores[0].history[1].fromDueDate)
  })
})

describe('people', () => {
  it('unassigns chores when a person is removed rather than deleting them', () => {
    const withPerson = reducer(EMPTY, { type: 'person/add', name: 'Sam' })
    const person = withPerson.people[0]
    const withTask = reducer(withPerson, {
      type: 'chore/add',
      draft: draft({ assigneeId: person.id }),
    })

    const removed = reducer(withTask, { type: 'person/remove', id: person.id })
    expect(removed.people).toHaveLength(0)
    expect(removed.chores).toHaveLength(1)
    expect(removed.chores[0].assigneeId).toBeNull()
  })

  it('ignores a blank name', () => {
    expect(reducer(EMPTY, { type: 'person/add', name: '   ' }).people).toHaveLength(0)
  })
})

describe('statusOf', () => {
  const base = withChore()[1]

  it('classifies by due date relative to today', () => {
    expect(statusOf({ ...base, dueDate: '2026-07-25' }, '2026-07-26')).toBe('overdue')
    expect(statusOf({ ...base, dueDate: '2026-07-26' }, '2026-07-26')).toBe('today')
    expect(statusOf({ ...base, dueDate: '2026-07-27' }, '2026-07-26')).toBe('upcoming')
    expect(statusOf({ ...base, dueDate: null }, '2026-07-26')).toBe('someday')
  })

  it('treats completion as overriding the due date', () => {
    const done = { ...base, dueDate: '2020-01-01', completedAt: '2020-01-02T00:00:00.000Z' }
    expect(statusOf(done, '2026-07-26')).toBe('done')
  })
})

describe('sortChores', () => {
  it('puts overdue first and done last', () => {
    const base = withChore()[1]
    const chores: Chore[] = [
      { ...base, id: 'a', title: 'upcoming', dueDate: '2026-08-01' },
      { ...base, id: 'b', title: 'done', completedAt: '2026-07-01T00:00:00.000Z' },
      { ...base, id: 'c', title: 'overdue', dueDate: '2026-07-01' },
      { ...base, id: 'd', title: 'today', dueDate: '2026-07-26' },
      { ...base, id: 'e', title: 'someday', dueDate: null },
    ]

    expect(sortChores(chores, '2026-07-26').map((chore) => chore.id)).toEqual([
      'c',
      'd',
      'a',
      'e',
      'b',
    ])
  })

  it('orders same-status chores by due date', () => {
    const base = withChore()[1]
    const chores: Chore[] = [
      { ...base, id: 'later', dueDate: '2026-07-10' },
      { ...base, id: 'earlier', dueDate: '2026-07-02' },
    ]
    expect(sortChores(chores, '2026-07-26').map((chore) => chore.id)).toEqual([
      'earlier',
      'later',
    ])
  })
})

describe('matchesFilters', () => {
  const base = withChore()[1]
  const open = { ...base, dueDate: '2026-07-01' }
  const done = { ...base, completedAt: '2026-07-02T00:00:00.000Z' }
  const all = { status: 'all', assigneeId: null, search: '' } as const

  it('splits open from done', () => {
    expect(matchesFilters(open, { ...all, status: 'open' }, '2026-07-26')).toBe(true)
    expect(matchesFilters(done, { ...all, status: 'open' }, '2026-07-26')).toBe(false)
    expect(matchesFilters(done, { ...all, status: 'done' }, '2026-07-26')).toBe(true)
    expect(matchesFilters(open, { ...all, status: 'overdue' }, '2026-07-26')).toBe(true)
  })

  it('searches title and notes case-insensitively', () => {
    const chore = { ...open, title: 'Mop the Kitchen', notes: 'use the good bucket' }
    expect(matchesFilters(chore, { ...all, search: 'kitchen' }, '2026-07-26')).toBe(true)
    expect(matchesFilters(chore, { ...all, search: 'BUCKET' }, '2026-07-26')).toBe(true)
    expect(matchesFilters(chore, { ...all, search: 'laundry' }, '2026-07-26')).toBe(false)
  })

  it('filters by assignee', () => {
    const mine = { ...open, assigneeId: 'p1' }
    expect(matchesFilters(mine, { ...all, assigneeId: 'p1' }, '2026-07-26')).toBe(true)
    expect(matchesFilters(mine, { ...all, assigneeId: 'p2' }, '2026-07-26')).toBe(false)
  })
})
