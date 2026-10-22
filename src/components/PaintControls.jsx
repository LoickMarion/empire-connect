import { useMemo, useState } from 'react'
import { formatYear } from '../game/formatYear.js'
import { ownershipAtYear } from '../game/ownershipAtYear.js'
import { PRESENT_YEAR } from '../data/dataSource.js'

const MIN_YEAR = -10000
const MAX_YEAR = PRESENT_YEAR
const STEPS = [100, 25, 5, 1]

// Years run ... -2, -1, 1, 2 ... (there is no year 0), so stepping across the BCE/CE boundary skips it.
function stepYear(year, delta) {
  let next = year + delta
  if (year < 0 && next >= 0) next += 1
  else if (year > 0 && next <= 0) next -= 1
  return Math.max(MIN_YEAR, Math.min(MAX_YEAR, next))
}

// Accepts "1453", "-500", "500 BCE", "500 BC", "1453 CE" or "AD 1453"; BCE/BC means negative.
function parseYear(text) {
  const m = /^\s*(?:(AD|CE)\s*)?(-?\d+)\s*(BCE|BC|CE|AD)?\s*$/i.exec(text)
  if (!m) return null
  let year = parseInt(m[2], 10)
  if (m[3] && /^BC/i.test(m[3])) year = -Math.abs(year)
  if (year === 0) return null
  return Math.max(MIN_YEAR, Math.min(MAX_YEAR, year))
}

export default function PaintControls({ holdings, empires, colorAt, year, onYearChange }) {
  const [draft, setDraft] = useState(null) // what's being typed, until Enter or blur
  const commit = () => {
    const parsed = draft === null ? null : parseYear(draft)
    if (parsed !== null) onYearChange(parsed)
    setDraft(null)
  }
  const empireById = useMemo(() => Object.fromEntries(empires.map((e) => [e.id, e])), [empires])

  const legend = useMemo(() => {
    const ownership = ownershipAtYear(holdings, year)
    const counts = new Map()
    for (const holding of ownership.values()) {
      counts.set(holding.empireId, (counts.get(holding.empireId) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([empireId, count]) => ({ empire: empireById[empireId], count }))
      .filter((e) => e.empire)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
  }, [holdings, year, empireById])

  return (
    <div className="controls">
      <div className="header">
        <h1>Paint the World</h1>
      </div>

      <div className="year-picker">
        <div className="year-input-row">
          <input
            className="year-input"
            type="text"
            inputMode="numeric"
            aria-label="Year (negative or BCE for years before the common era)"
            value={draft ?? String(year)}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setDraft(null)
                e.currentTarget.blur()
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const base = draft === null ? year : (parseYear(draft) ?? year)
                const size = e.shiftKey ? 25 : 1
                setDraft(null)
                onYearChange(stepYear(base, e.key === 'ArrowUp' ? size : -size))
              }
            }}
          />
          <span className="year-era">{year < 0 ? 'BCE' : 'CE'}</span>
        </div>
        <div className="year-buttons">
          {STEPS.map((n) => (
            <button key={`-${n}`} onClick={() => onYearChange(stepYear(year, -n))} disabled={year <= MIN_YEAR} aria-label={`Back ${n} years`}>
              −{n}
            </button>
          ))}
          {[...STEPS].reverse().map((n) => (
            <button key={`+${n}`} onClick={() => onYearChange(stepYear(year, n))} disabled={year >= MAX_YEAR} aria-label={`Forward ${n} years`}>
              +{n}
            </button>
          ))}
        </div>
      </div>

      <p className="hint">
        Each province is colored by whoever occupied it in {formatYear(year)}. Subjects (colonies, puppets, occupied lands) are shown in a lighter shade of their overlord. Uncolored provinces have no recorded
        occupier that year. Type a year (negative or "BCE" for earlier times), or use the arrows to step by 1, 5, 25
        or 100 years. In the box, ↑/↓ steps by 1 and Shift+↑/↓ by 25. The underlying borders change every century or
        so, so small steps only move the map when they cross one of those snapshots.
      </p>

      <ol className="legend">
        {legend.map(({ empire, count }) => (
          <li key={empire.id}>
            <span className="swatch" style={{ background: colorAt(empire.id, year) }} />
            <span className="empire-name">
              {empire.name}
              {empire.isNation === false && ' (people/culture)'}
            </span>
            <span className="year-range">{count} provinces</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
