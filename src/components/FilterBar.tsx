import type { Filters } from '../lib/chores'
import type { Person, StatusFilter } from '../types'

interface Props {
  filters: Filters
  people: Person[]
  counts: Record<StatusFilter, number>
  onChange: (filters: Filters) => void
}

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
]

export function FilterBar({ filters, people, counts, onChange }: Props) {
  return (
    <div className="filters">
      <div className="filters__tabs" role="tablist" aria-label="Filter chores by status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={filters.status === tab.value}
            className={`tab ${filters.status === tab.value ? 'tab--active' : ''}`}
            onClick={() => onChange({ ...filters, status: tab.value })}
          >
            {tab.label}
            <span className="tab__count">{counts[tab.value]}</span>
          </button>
        ))}
      </div>

      <div className="filters__inputs">
        <label className="visually-hidden" htmlFor="filter-assignee">
          Filter by person
        </label>
        <select
          id="filter-assignee"
          value={filters.assigneeId ?? ''}
          onChange={(event) =>
            onChange({ ...filters, assigneeId: event.target.value || null })
          }
        >
          <option value="">Everyone</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>

        <label className="visually-hidden" htmlFor="filter-search">
          Search chores
        </label>
        <input
          id="filter-search"
          type="search"
          placeholder="Search"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </div>
    </div>
  )
}
