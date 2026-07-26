import { statusOf } from '../lib/chores'
import { describeRecurrence, formatDueDate, type DateString } from '../lib/dates'
import { colorSoftVar, colorVar } from '../lib/palette'
import type { Chore, Person } from '../types'

interface Props {
  chore: Chore
  assignee: Person | undefined
  now: DateString
  onComplete: () => void
  onUndo: () => void
  onEdit: () => void
  onRemove: () => void
}

const STATUS_LABEL: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  done: 'Done',
}

export function ChoreItem({ chore, assignee, now, onComplete, onUndo, onEdit, onRemove }: Props) {
  const status = statusOf(chore, now)
  const isDone = status === 'done'
  // A recurring chore is never "done", but it can still be rolled back to the
  // occurrence that was just ticked off.
  const canUndo = isDone || (chore.recurrence !== null && chore.history.length > 0)

  return (
    <li className={`chore chore--${status}`}>
      <input
        type="checkbox"
        className="chore__check"
        checked={isDone}
        aria-label={isDone ? `Mark ${chore.title} as not done` : `Mark ${chore.title} as done`}
        onChange={() => (isDone ? onUndo() : onComplete())}
      />

      <div className="chore__body">
        <p className="chore__title">{chore.title}</p>
        {chore.notes && <p className="chore__notes">{chore.notes}</p>}

        <div className="chore__meta">
          {STATUS_LABEL[status] && (
            <span className={`tag tag--${status}`}>{STATUS_LABEL[status]}</span>
          )}
          {/* The status tag already says "Due today", so the date would repeat it. */}
          {chore.dueDate && !isDone && status !== 'today' && (
            <span className="tag">{formatDueDate(chore.dueDate, now)}</span>
          )}
          {chore.recurrence && (
            <span className="tag">{describeRecurrence(chore.recurrence)}</span>
          )}
          {assignee && (
            <span
              className="tag tag--person"
              style={{
                color: colorVar(assignee.colorIndex),
                background: colorSoftVar(assignee.colorIndex),
              }}
            >
              {assignee.name}
            </span>
          )}
        </div>
      </div>

      <div className="chore__actions">
        {canUndo && !isDone && (
          <button type="button" className="button button--quiet" onClick={onUndo}>
            Undo
          </button>
        )}
        <button
          type="button"
          className="button button--quiet"
          onClick={onEdit}
          aria-label={`Edit ${chore.title}`}
        >
          Edit
        </button>
        <button
          type="button"
          className="button button--quiet button--danger"
          onClick={onRemove}
          aria-label={`Delete ${chore.title}`}
        >
          Delete
        </button>
      </div>
    </li>
  )
}
