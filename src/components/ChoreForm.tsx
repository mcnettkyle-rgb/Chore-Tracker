import { useEffect, useId, useRef, useState } from 'react'
import type { ChoreDraft } from '../lib/chores'
import { today } from '../lib/dates'
import type { Person, RecurrenceUnit } from '../types'

interface Props {
  draft: ChoreDraft
  people: Person[]
  submitLabel: string
  onSubmit: (draft: ChoreDraft) => void
  onCancel?: () => void
}

/**
 * Create/edit form for a chore. Held as local state and only handed upward on
 * submit, so an abandoned edit leaves the stored chore untouched.
 */
export function ChoreForm({ draft, people, submitLabel, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(draft)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()

  // Re-seed when the caller switches which chore is being edited.
  useEffect(() => setValue(draft), [draft])

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!value.title.trim()) {
      setError('Give the chore a name.')
      titleRef.current?.focus()
      return
    }
    setError(null)
    onSubmit(value)
    setValue(draft)
  }

  const repeats = value.recurrence !== null

  return (
    <form className="chore-form" onSubmit={handleSubmit}>
      <div className="field field--grow">
        <label htmlFor={`${fieldId}-title`}>Chore</label>
        <input
          id={`${fieldId}-title`}
          ref={titleRef}
          type="text"
          placeholder="Take out the recycling"
          value={value.title}
          aria-invalid={error !== null}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          onChange={(event) => setValue({ ...value, title: event.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-due`}>Due</label>
        <input
          id={`${fieldId}-due`}
          type="date"
          value={value.dueDate ?? ''}
          min="1970-01-01"
          onChange={(event) =>
            setValue({ ...value, dueDate: event.target.value || null })
          }
        />
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-assignee`}>Assigned to</label>
        <select
          id={`${fieldId}-assignee`}
          value={value.assigneeId ?? ''}
          onChange={(event) =>
            setValue({ ...value, assigneeId: event.target.value || null })
          }
        >
          <option value="">Anyone</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field field--repeat">
        <label htmlFor={`${fieldId}-repeat`}>Repeats</label>
        <div className="repeat-controls">
          <select
            id={`${fieldId}-repeat`}
            value={repeats ? value.recurrence!.unit : ''}
            onChange={(event) => {
              const unit = event.target.value as RecurrenceUnit | ''
              setValue({
                ...value,
                recurrence: unit ? { unit, interval: value.recurrence?.interval ?? 1 } : null,
                // A repeating chore with no start date has nothing to advance
                // from, so anchor it to today the moment repetition is switched on.
                dueDate: unit && !value.dueDate ? today() : value.dueDate,
              })
            }}
          >
            <option value="">Never</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
          {repeats && (
            <label className="repeat-interval">
              every
              <input
                type="number"
                min={1}
                max={99}
                aria-label="Repeat interval"
                value={value.recurrence!.interval}
                onChange={(event) =>
                  setValue({
                    ...value,
                    recurrence: {
                      ...value.recurrence!,
                      interval: Number(event.target.value) || 1,
                    },
                  })
                }
              />
              {`${value.recurrence!.unit}s`}
            </label>
          )}
        </div>
      </div>

      <div className="field field--grow">
        <label htmlFor={`${fieldId}-notes`}>Notes</label>
        <input
          id={`${fieldId}-notes`}
          type="text"
          placeholder="Optional"
          value={value.notes}
          onChange={(event) => setValue({ ...value, notes: event.target.value })}
        />
      </div>

      <div className="chore-form__actions">
        <button type="submit" className="button button--primary">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {error && (
        <p className="chore-form__error" id={`${fieldId}-error`} role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
