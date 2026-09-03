import { formatYear } from '../game/formatYear.js'

export default function ExplorePanel({ city, holdings }) {
  return (
    <div className="controls">
      <div className="header">
        <h1>Explore</h1>
      </div>

      {!city && <p className="hint">Click a city on the map to see every state that has ever held it.</p>}

      {city && (
        <>
          <h2>{city.name}</h2>

          {city.names.length > 1 && (
            <p className="hint">
              Also known as:{' '}
              {city.names
                .filter((n) => n.name !== city.name)
                .map((n) => `${n.name} (${formatYear(n.startYear)}–${n.endYear == null ? 'present' : formatYear(n.endYear)})`)
                .join(', ')}
            </p>
          )}

          {holdings.length === 0 ? (
            <p className="hint">No recorded holdings for this city.</p>
          ) : (
            <ol className="history">
              {holdings.map((h, i) => (
                <li key={i}>
                  <span className="empire-name">
                    {h.nation}
                    {h.synthetic && ' (current country — no detailed history recorded)'}
                  </span>
                  <span className="year-range">
                    {h.synthetic ? 'present' : `${formatYear(h.start)}–${formatYear(h.end)}`}
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
