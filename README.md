# Chore Tracker

A small web app for keeping track of household chores — what needs doing, who it
belongs to, and when it is due.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Re-run tests on change |
| `npm run lint` | Lint with oxlint |

The build output in `dist/` is fully static, so it can be served from any static
host with no backend.

## What it does

- **Chores** — add, edit, delete, and tick off. Each one can carry notes, a due
  date, an assignee, and a repeat schedule.
- **Due dates** — chores are grouped and sorted by urgency: overdue first, then
  due today, then upcoming, then undated, with finished chores at the bottom.
  Dates are shown the way you'd say them ("Tomorrow", "in 3 days", "Sep 4").
- **Recurring chores** — daily, weekly, or monthly, at any interval ("every 2
  weeks"). Completing one rolls it forward to its next occurrence instead of
  marking it done, so the list always shows what's coming rather than a growing
  pile of finished copies.
- **People** — add whoever shares the chores, assign chores to them, and filter
  the list by person. Each person gets a color that stays consistent.
- **Filters** — tabs for open / overdue / done / all, plus a person filter and a
  text search over titles and notes.

Everything is stored in the browser's `localStorage`, so it works offline and
needs no account — but the data lives on that one device and browser, and
clearing site data clears the chores.

## Notable behaviour

A few decisions that aren't obvious from the outside:

- **Dates are local, not UTC.** They're handled as `YYYY-MM-DD` strings in the
  user's own calendar. Parsing `2026-07-26` with `new Date()` yields UTC
  midnight, which lands on the previous day for anyone west of Greenwich — a
  chore due "today" should mean today where you're standing.
- **Late completions don't shift the schedule.** A weekly chore due Monday and
  actually done Wednesday comes back due the following Monday, not the following
  Wednesday.
- **Missed occurrences are skipped, not stacked.** A daily chore ignored for a
  month comes back due tomorrow, once — not thirty times over.
- **Undo replays history rather than recomputing it.** Each completion records
  the due date it advanced from, because month arithmetic isn't reversible
  (Jan 31 → Feb 28 → Mar 28 would silently drift).
- **Removing a person doesn't remove their chores.** Those chores just become
  unassigned.
- **Saved data is validated on load.** `localStorage` can be hand-edited or left
  behind by an older version, so every field is checked on the way in. A single
  bad record degrades to "that chore is gone" rather than a blank screen.
- **The date rolls over on its own.** A tab left open past midnight re-evaluates
  what's due instead of showing yesterday's chores as due "Today" forever.

## Layout

```
src/
  lib/
    dates.ts       calendar-date maths and recurrence scheduling
    chores.ts      state reducer, status, filtering, sorting
    storage.ts     localStorage load/save with validation
    palette.ts     assignee colors
  hooks/
    useAppState.ts state + persistence
    useToday.ts    today's date, refreshed at midnight
  components/      ChoreForm, ChoreItem, FilterBar, PeoplePanel
  App.tsx          layout and wiring
```

Tests live next to the code they cover (`src/lib/*.test.ts`) and focus on the
parts where the logic is easy to get subtly wrong: recurrence scheduling, DST
and month-end edges, undo, and validating untrusted stored data.

## Built with

React 19, TypeScript, and Vite. No UI framework or state library — the app is
small enough that a reducer and plain CSS carry it, and the styling adapts to
the system light/dark preference.
