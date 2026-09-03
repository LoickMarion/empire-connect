import { formatYear } from '../game/formatYear.js'

export default function GameControls({ cityById, path, connections, targetCity, status, lastError, onNewGame }) {
  return (
    <div className="controls">
      <div className="header">
        <h1>Empire Connect</h1>
        <button onClick={onNewGame}>New Game</button>
      </div>

      {status === 'won' && (
        <div className="banner won">
          You connected {cityById[path[0]]?.name} to {cityById[targetCity]?.name}!
        </div>
      )}

      {lastError && <div className="banner error">{lastError}</div>}

      <ol className="path">
        {path.map((cityId, i) => (
          <li key={cityId}>
            <span className="city-name">{cityById[cityId]?.name}</span>
            {connections[i] && (
              <div className="connection">
                via <strong>{connections[i].nation}</strong> ({formatYear(connections[i].overlapStart)}–
                {formatYear(connections[i].overlapEnd)})
              </div>
            )}
          </li>
        ))}
      </ol>

      {status === 'in-progress' && (
        <p className="hint">
          Click a city on the map that was held by the same nation as <strong>{cityById[path[path.length - 1]]?.name}</strong> at
          some overlapping time, to continue toward <strong>{cityById[targetCity]?.name}</strong>.
        </p>
      )}
    </div>
  )
}
