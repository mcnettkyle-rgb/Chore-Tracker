import { useMemo, useState } from 'react'
import { ChoreForm } from './components/ChoreForm'
import { ChoreItem } from './components/ChoreItem'
import { FilterBar } from './components/FilterBar'
import { PeoplePanel } from './components/PeoplePanel'
import { useAppState } from './hooks/useAppState'
import { useToday } from './hooks/useToday'
import {
  EMPTY_DRAFT,
  draftFrom,
  matchesFilters,
  sortChores,
  statusOf,
  type ChoreDraft,
  type Filters,
} from './lib/chores'
import type { StatusFilter } from './types'

const INITIAL_FILTERS: Filters = { status: 'open', assigneeId: null, search: '' }

export default function App() {
  const [state, dispatch] = useAppState()
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [editingId, setEditingId] = useState<string | null>(null)
  const now = useToday()

  const peopleById = useMemo(
    () => new Map(state.people.map((person) => [person.id, person])),
    [state.people],
  )

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { all: 0, open: 0, overdue: 0, done: 0 }
    for (const chore of state.chores) {
      const status = statusOf(chore, now)
      result.all += 1
      if (status === 'done') result.done += 1
      else result.open += 1
      if (status === 'overdue') result.overdue += 1
    }
    return result
  }, [state.chores, now])

  const visible = useMemo(
    () => sortChores(state.chores.filter((chore) => matchesFilters(chore, filters, now)), now),
    [state.chores, filters, now],
  )

  const editing = editingId ? state.chores.find((chore) => chore.id === editingId) : undefined
  // Falling back to a stable constant keeps the form's re-seed effect from
  // firing on every render when nothing is being edited.
  const formDraft: ChoreDraft = editing ? draftFrom(editing) : EMPTY_DRAFT

  function handleSubmit(draft: ChoreDraft) {
    if (editingId) {
      dispatch({ type: 'chore/update', id: editingId, draft })
      setEditingId(null)
    } else {
      dispatch({ type: 'chore/add', draft })
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">Chore Tracker</h1>
        <p className="header__subtitle">
          {counts.open === 0
            ? 'Nothing outstanding. Enjoy it.'
            : `${counts.open} open${counts.overdue > 0 ? `, ${counts.overdue} overdue` : ''}`}
        </p>
      </header>

      <main className="layout">
        <section className="panel panel--main">
          <h2 className="panel__title">{editing ? 'Edit chore' : 'Add a chore'}</h2>
          <ChoreForm
            key={editingId ?? 'new'}
            draft={formDraft}
            people={state.people}
            submitLabel={editing ? 'Save changes' : 'Add chore'}
            onSubmit={handleSubmit}
            onCancel={editing ? () => setEditingId(null) : undefined}
          />

          <FilterBar
            filters={filters}
            people={state.people}
            counts={counts}
            onChange={setFilters}
          />

          {visible.length === 0 ? (
            <p className="panel__empty">
              {state.chores.length === 0
                ? 'No chores yet. Add the first one above.'
                : 'Nothing matches these filters.'}
            </p>
          ) : (
            <ul className="chores">
              {visible.map((chore) => (
                <ChoreItem
                  key={chore.id}
                  chore={chore}
                  assignee={chore.assigneeId ? peopleById.get(chore.assigneeId) : undefined}
                  now={now}
                  onComplete={() => dispatch({ type: 'chore/complete', id: chore.id })}
                  onUndo={() => dispatch({ type: 'chore/undo', id: chore.id })}
                  onEdit={() => setEditingId(chore.id)}
                  onRemove={() => {
                    dispatch({ type: 'chore/remove', id: chore.id })
                    if (editingId === chore.id) setEditingId(null)
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="sidebar">
          <PeoplePanel
            people={state.people}
            chores={state.chores}
            onAdd={(name) => dispatch({ type: 'person/add', name })}
            onRename={(id, name) => dispatch({ type: 'person/rename', id, name })}
            onRemove={(id) => {
              dispatch({ type: 'person/remove', id })
              if (filters.assigneeId === id) setFilters({ ...filters, assigneeId: null })
            }}
          />
        </aside>
      </main>
    </div>
  )
}
