import { formatYear } from '../game/formatYear.js'

export default function GameControls({
  cityById,
  path,
  connections,
  targetCity,
  status,
  lastError,
  onNewGame,
  solutions,
  showSolutions,
  onToggleSolutions,
  easyMode,
  onEasyModeChange,
  onUndo,
}) {
  return (
    <div className="controls">
      <div className="header">
        <h1>Empire Connect</h1>
        <button onClick={onNewGame}>New Game</button>
      </div>

      <label className="easy-toggle">
        <input type="checkbox" checked={easyMode} onChange={(e) => onEasyModeChange(e.target.checked)} /> Easy mode (undo guesses, hover a
        province to see who held it)
      </label>
      {easyMode && (
        <button onClick={onUndo} disabled={path.length <= 1}>
          Undo last guess
        </button>
      )}

      {status === 'won' && (
        <div className="banner won">
          ✓ You connected {cityById[path[0]]?.name} to {cityById[targetCity]?.name} in {path.length - 1} {path.length - 1 === 1 ? 'step' : 'steps'}!
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
                {(connections[i].viaA || connections[i].viaB) && (
                  <div className="hint">
                    {[
                      connections[i].viaA && `${cityById[path[i - 1]]?.name} was ${connections[i].viaA}`,
                      connections[i].viaB && `${cityById[cityId]?.name} was ${connections[i].viaB}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    (a colony or dependency of {connections[i].nation})
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      {status === 'in-progress' && (
        <p className="hint">
          Click a province on the map that was held by the same nation as <strong>{cityById[path[path.length - 1]]?.name}</strong> at
          some overlapping time, to continue toward <strong>{cityById[targetCity]?.name}</strong>.
        </p>
      )}

      <button className="solutions-toggle" onClick={onToggleSolutions}>
        {showSolutions ? 'Hide solutions' : 'Show shortest solutions'}
      </button>

      {showSolutions && solutions && (
        <div className="solutions">
          <p className="hint">
            The shortest route takes <strong>{solutions.distance}</strong> steps.{' '}
            {solutions.total === 1
              ? 'It is the only shortest route.'
              : `${solutions.total.toLocaleString()} different shortest routes exist; here are ${solutions.items.length} that differ as much as possible.`}
          </p>
          {solutions.items.map(({ path: route, steps }, i) => (
            <div key={i} className="solution">
              <strong>Solution {i + 1}</strong>
              <ol className="path">
                <li>
                  <span className="city-name">{cityById[route[0]]?.name}</span>
                </li>
                {steps.map((step) => (
                  <li key={step.to}>
                    <div className="connection">
                      via <strong>{step.connection.nation}</strong> ({formatYear(step.connection.overlapStart)}–
                      {formatYear(step.connection.overlapEnd)})
                      {(step.connection.viaA || step.connection.viaB) && (
                        <div className="hint">
                          {[
                            step.connection.viaA && `${cityById[step.from]?.name} was ${step.connection.viaA}`,
                            step.connection.viaB && `${cityById[step.to]?.name} was ${step.connection.viaB}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                    <span className="city-name">{cityById[step.to]?.name}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
