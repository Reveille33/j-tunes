/**
 * The year to keep when the dropdown's options change.
 * A year the current show does not have becomes All years (`null`).
 */
export function yearForShow(selected: number | null, years: number[]): number | null {
  if (selected == null) return null
  return years.includes(selected) ? selected : null
}
