/**
 * Assignee colors. Each entry is a CSS custom property pair defined in
 * `index.css` so the same person keeps their identity in light and dark themes.
 */
export const PERSON_COLORS = ['plum', 'teal', 'amber', 'rose', 'indigo', 'moss'] as const

export function colorVar(colorIndex: number): string {
  const name = PERSON_COLORS[colorIndex % PERSON_COLORS.length]
  return `var(--person-${name})`
}

export function colorSoftVar(colorIndex: number): string {
  const name = PERSON_COLORS[colorIndex % PERSON_COLORS.length]
  return `var(--person-${name}-soft)`
}
