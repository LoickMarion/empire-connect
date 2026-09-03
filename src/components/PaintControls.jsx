import { useMemo } from 'react'
import { formatYear } from '../game/formatYear.js'
import { ownershipAtYear } from '../game/ownershipAtYear.js'

export default function PaintControls({ holdings, empires, minYear, maxYear, year, onYearChange }) {
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
        <input
          type="range"
          min={minYear}
          max={maxYear}
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
        />
        <div className="year-picker-value">{formatYear(year)}</div>
      </div>

      <p className="hint">
        Each city's territory is estimated as the region closer to it than to any other city, colored by whichever
        state held that city in {formatYear(year)}.
      </p>

      <ol className="legend">
        {legend.map(({ empire, count }) => (
          <li key={empire.id}>
            <span className="swatch" style={{ background: empire.color }} />
            <span className="empire-name">{empire.name}</span>
            <span className="year-range">{count} cities</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
