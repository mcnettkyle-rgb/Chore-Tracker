import { useEffect, useReducer } from 'react'
import { reducer, type Action } from '../lib/chores'
import { loadState, saveState } from '../lib/storage'
import type { AppState } from '../types'

/**
 * App state backed by localStorage. The initial read is lazy so it happens once
 * on mount rather than on every render, and writes are effect-driven so a failed
 * save never interrupts a state update.
 */
export function useAppState(): [AppState, React.Dispatch<Action>] {
  const [state, dispatch] = useReducer(reducer, null, () => loadState())

  useEffect(() => {
    saveState(state)
  }, [state])

  return [state, dispatch]
}
