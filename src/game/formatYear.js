export function formatYear(year) {
  return year < 0 ? `${-year} BCE` : `${year} CE`
}
