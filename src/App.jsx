import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView.jsx'
import GameControls from './components/GameControls.jsx'
import ExplorePanel from './components/ExplorePanel.jsx'
import PaintControls from './components/PaintControls.jsx'
import { getProvinces, getOccupations, getOccupiers, getRealmLinks } from './data/dataSource.js'
import { expandWithRealms } from './game/realms.js'
import { createColorResolver } from './game/colors.js'
import { findConnections } from './game/pathValidator.js'
import { createGraph, describePaths, diversePaths, pickGamePair, shortestPaths } from './game/solver.js'

const MODES = ['game', 'explore', 'paint']

// A start and target 2 to 7 steps apart (so at least one intermediate province) by the shortest route.
function newGameState(playable, graph) {
  const pair = pickGamePair(graph, playable, { min: 2, max: 7 })
  const [start, target] = pair ? [pair.start, pair.target] : [playable[0].id, playable[1].id]
  return {
    startCity: start,
    targetCity: target,
    path: [start],
    connections: [undefined],
    status: 'in-progress',
    lastError: null,
    solutions: null, // filled in on request: { distance, total, items }
    showSolutions: false,
  }
}

export default function App() {
  const [data, setData] = useState(null)
  const [game, setGame] = useState(null)
  const [mode, setMode] = useState('game')
  const [exploreCityId, setExploreCityId] = useState(null)
  const [paintYear, setPaintYear] = useState(1500)
  const [showCities, setShowCities] = useState(false)
  const [easyMode, setEasyMode] = useState(false)
  const [winDismissed, setWinDismissed] = useState(false)

  useEffect(() => {
    Promise.all([getProvinces(), getOccupations(), getOccupiers(), getRealmLinks()]).then(([cities, holdings, empires, realmLinks]) => {
      const cityById = Object.fromEntries(cities.map((c) => [c.id, c]))
      const colorAt = createColorResolver(empires, realmLinks)
      const minYear = Math.min(...holdings.map((h) => h.start))
      const maxYear = Math.max(...holdings.map((h) => h.end))
      // Provinces no nation is recorded as holding can't connect to anything (peoples and cultures
      // don't count), so keep them out of games.
      const occupied = new Set(holdings.filter((h) => h.isNation).map((h) => h.city))
      const playable = cities.filter((c) => occupied.has(c.id))
      // for linking provinces, colonies also count as held by their parent realm
      const linkHoldings = expandWithRealms(holdings, realmLinks)
      const graph = createGraph(linkHoldings)
      setData({ cities, playable, holdings, linkHoldings, graph, empires, cityById, colorAt, minYear, maxYear })
      setGame(newGameState(playable, graph))
    })
  }, [])

  const pathIds = useMemo(() => game?.path ?? [], [game])

  // Everyone who has held each province, oldest first, for the easy-mode hover list.
  const historyByCity = useMemo(() => {
    if (!data) return null
    const map = new Map()
    for (const h of data.holdings) {
      if (h.synthetic) continue
      if (!map.has(h.city)) map.set(h.city, [])
      map.get(h.city).push(h)
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start)
    return map
  }, [data])

  function handleUndo() {
    setGame((g) =>
      g.path.length <= 1
        ? g
        : { ...g, path: g.path.slice(0, -1), connections: g.connections.slice(0, -1), status: 'in-progress', lastError: null },
    )
    setWinDismissed(false)
  }

  function handleNewGame() {
    setGame(newGameState(data.playable, data.graph))
    setWinDismissed(false)
  }

  // Reveal up to 3 of the shortest routes, chosen to be as different from each other as possible.
  function handleToggleSolutions() {
    if (game.solutions) {
      setGame((g) => ({ ...g, showSolutions: !g.showSolutions }))
      return
    }
    const result = shortestPaths(data.graph, game.startCity, game.targetCity)
    if (!result) return
    const chosen = diversePaths(result.paths, 3, data.graph, (id) => data.cityById[id]?.country)
    const items = describePaths(data.graph, chosen)
    setGame((g) => ({ ...g, showSolutions: true, solutions: { distance: result.distance, total: result.total, items } }))
  }

  function handleGameCityClick(cityId) {
    if (game.status === 'won') return
    const last = game.path[game.path.length - 1]
    if (cityId === last || game.path.includes(cityId)) return

    const conns = findConnections(last, cityId, data.linkHoldings)
    if (conns.length === 0) {
      setGame((g) => ({
        ...g,
        lastError: `No occupier held both ${data.cityById[last].name} and ${data.cityById[cityId].name} at the same time.`,
      }))
      return
    }

    const connection = conns.reduce((best, c) => (c.overlapEnd - c.overlapStart > best.overlapEnd - best.overlapStart ? c : best))
    setGame((g) => {
      const path = [...g.path, cityId]
      const connections = [...g.connections, connection]
      const status = cityId === g.targetCity ? 'won' : 'in-progress'
      return { ...g, path, connections, status, lastError: null }
    })
  }

  function handleCityClick(cityId) {
    if (mode === 'explore') {
      setExploreCityId(cityId)
    } else if (mode === 'game') {
      handleGameCityClick(cityId)
    }
  }

  if (!data || !game) {
    return (
      <div className="app">
        <p className="loading">Loading world data…</p>
      </div>
    )
  }

  const exploreCity = exploreCityId ? data.cityById[exploreCityId] : null
  const exploreHoldings = exploreCity
    ? [...data.holdings].filter((h) => h.city === exploreCityId).sort((a, b) => a.start - b.start)
    : []

  const modeLabel = { game: 'Game', explore: 'Explore', paint: 'Paint' }

  return (
    <div className="app">
      <div className="map-pane">
        <div className="mode-toggle">
          {MODES.map((m) => (
            <button key={m} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>
              {modeLabel[m]}
            </button>
          ))}
          <label>
            <input type="checkbox" checked={showCities} onChange={(e) => setShowCities(e.target.checked)} /> Cities
          </label>
        </div>
        <MapView
          cities={data.cities}
          startCity={mode === 'game' ? game.startCity : null}
          targetCity={mode === 'game' ? game.targetCity : null}
          pathIds={mode === 'game' ? pathIds : []}
          selectedCityId={mode === 'explore' ? exploreCityId : null}
          onCityClick={handleCityClick}
          paintMode={mode === 'paint'}
          paintYear={paintYear}
          holdings={data.holdings}
          colorAt={data.colorAt}
          showCities={showCities}
          historyByCity={mode === 'game' && easyMode ? historyByCity : null}
          won={mode === 'game' && game.status === 'won'}
        />
        {mode === 'game' && game.status === 'won' && !winDismissed && (
          <div className="win-card" role="status">
            <div className="win-title">Connected!</div>
            <div>
              {data.cityById[game.startCity]?.name} → {data.cityById[game.targetCity]?.name} in {game.path.length - 1}{' '}
              {game.path.length - 1 === 1 ? 'step' : 'steps'}
            </div>
            <div className="win-actions">
              <button onClick={handleNewGame}>New Game</button>
              <button onClick={() => setWinDismissed(true)}>Close</button>
            </div>
          </div>
        )}
      </div>
      {mode === 'game' && (
        <GameControls
          cityById={data.cityById}
          path={game.path}
          connections={game.connections}
          targetCity={game.targetCity}
          status={game.status}
          lastError={game.lastError}
          onNewGame={handleNewGame}
          solutions={game.solutions}
          showSolutions={game.showSolutions}
          onToggleSolutions={handleToggleSolutions}
          easyMode={easyMode}
          onEasyModeChange={setEasyMode}
          onUndo={handleUndo}
        />
      )}
      {mode === 'explore' && <ExplorePanel city={exploreCity} holdings={exploreHoldings} />}
      {mode === 'paint' && (
        <PaintControls
          holdings={data.holdings}
          empires={data.empires}
          colorAt={data.colorAt}
          year={paintYear}
          onYearChange={setPaintYear}
        />
      )}
    </div>
  )
}
