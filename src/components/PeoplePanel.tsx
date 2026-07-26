import { useState } from 'react'
import { colorSoftVar, colorVar } from '../lib/palette'
import type { Chore, Person } from '../types'

interface Props {
  people: Person[]
  chores: Chore[]
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

export function PeoplePanel({ people, chores, onAdd, onRename, onRemove }: Props) {
  const [name, setName] = useState('')

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    onAdd(name)
    setName('')
  }

  return (
    <section className="panel">
      <h2 className="panel__title">Household</h2>

      {people.length === 0 && (
        <p className="panel__empty">Add the people who share these chores.</p>
      )}

      <ul className="people">
        {people.map((person) => {
          const open = chores.filter(
            (chore) => chore.assigneeId === person.id && !chore.completedAt,
          ).length

          return (
            <li key={person.id} className="person">
              <span className="person__dot" style={{ background: colorVar(person.colorIndex) }} />
              <input
                className="person__name"
                value={person.name}
                aria-label={`Name for ${person.name}`}
                onChange={(event) => onRename(person.id, event.target.value)}
              />
              <span
                className="person__count"
                style={{
                  color: colorVar(person.colorIndex),
                  background: colorSoftVar(person.colorIndex),
                }}
                title={`${open} open ${open === 1 ? 'chore' : 'chores'}`}
              >
                {open}
              </span>
              <button
                type="button"
                className="button button--quiet button--danger"
                onClick={() => onRemove(person.id)}
                aria-label={`Remove ${person.name}`}
              >
                Remove
              </button>
            </li>
          )
        })}
      </ul>

      <form className="person-add" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Add someone"
          aria-label="Name of person to add"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="button">
          Add
        </button>
      </form>
    </section>
  )
}
