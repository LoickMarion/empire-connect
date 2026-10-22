import { formatYear } from '../game/formatYear.js'
import { PRESENT_YEAR } from '../data/dataSource.js'

export default function ExplorePanel({ city, holdings }) {
  return (
    <div className="controls">
      <div className="header">
        <h1>Explore</h1>
      </div>

      {!city && <p className="hint">Click a province on the map to see everyone who has ever occupied it.</p>}

      {city && (
        <>
          <h2>{city.name}</h2>
          <p className="hint">
            {city.region === city.country ? city.country : `${city.region}, ${city.country}`} · {city.areaKm2.toLocaleString()} km²
            {city.citySource === 'nearest' && ' · no town of its own, so it borrows the nearest one'}
          </p>

          {holdings.length === 0 ? (
            <p className="hint">No recorded occupiers for this province.</p>
          ) : (
            <ol className="history">
              {holdings.map((h, i) => (
                <li key={i}>
                  <span className="empire-name">
                    {h.nation}
                    {h.isNation === false && ' (people/culture, not a nation)'}
                  </span>
                  <span className="year-range">
                    {formatYear(h.start)}–{h.end === PRESENT_YEAR ? 'present' : formatYear(h.end)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
