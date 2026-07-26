import { useEffect, useState } from 'react'
import { today, type DateString } from '../lib/dates'

/**
 * Today's date, refreshed when the calendar day rolls over.
 *
 * A tab left open past midnight would otherwise keep showing yesterday's chores
 * as due "Today" and never mark them overdue. Polling once a minute is enough to
 * catch the rollover, and also picks up the case where a laptop wakes from sleep.
 */
export function useToday(): DateString {
  const [date, setDate] = useState(today)

  useEffect(() => {
    const timer = setInterval(() => {
      setDate((current) => {
        const now = today()
        return now === current ? current : now
      })
    }, 60_000)
    return () => clearInterval(timer)
  }, [])

  return date
}
