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

// A start and target 3 to 7 steps apart by the shortest route.
function newGameState(playable, graph) {
  const pair = pickGamePair(graph, playable, { min: 3, max: 7 })
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

  function handleNewGame() {
    setGame(newGameState(data.playable, data.graph))
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

  function handleCycleMode() {
    setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])
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
          <button onClick={handleCycleMode}>
            {modeLabel[mode]} Mode — switch to {modeLabel[MODES[(MODES.indexOf(mode) + 1) % MODES.length]]}
          </button>
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
        />
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
