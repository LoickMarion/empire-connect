import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView.jsx'
import GameControls from './components/GameControls.jsx'
import ExplorePanel from './components/ExplorePanel.jsx'
import PaintControls from './components/PaintControls.jsx'
import { getCities, getHoldings, getEmpires } from './data/dataSource.js'
import { findConnections } from './game/pathValidator.js'

const MODES = ['game', 'explore', 'paint']

function pickPair(cities) {
  const a = cities[Math.floor(Math.random() * cities.length)]
  let b = a
  while (b.id === a.id) {
    b = cities[Math.floor(Math.random() * cities.length)]
  }
  return [a.id, b.id]
}

function newGameState(cities) {
  const [start, target] = pickPair(cities)
  return {
    startCity: start,
    targetCity: target,
    path: [start],
    connections: [undefined],
    status: 'in-progress',
    lastError: null,
  }
}

export default function App() {
  const [data, setData] = useState(null)
  const [game, setGame] = useState(null)
  const [mode, setMode] = useState('game')
  const [exploreCityId, setExploreCityId] = useState(null)
  const [paintYear, setPaintYear] = useState(1500)

  useEffect(() => {
    Promise.all([getCities(), getHoldings(), getEmpires()]).then(([cities, holdings, empires]) => {
      const cityById = Object.fromEntries(cities.map((c) => [c.id, c]))
      const empireColorById = Object.fromEntries(empires.map((e) => [e.id, e.color]))
      const minYear = Math.min(...holdings.map((h) => h.start))
      const maxYear = Math.max(...holdings.map((h) => h.end))
      setData({ cities, holdings, empires, cityById, empireColorById, minYear, maxYear })
      setGame(newGameState(cities))
    })
  }, [])

  const pathIds = useMemo(() => game?.path ?? [], [game])

  function handleNewGame() {
    setGame(newGameState(data.cities))
  }

  function handleCycleMode() {
    setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])
  }

  function handleGameCityClick(cityId) {
    if (game.status === 'won') return
    const last = game.path[game.path.length - 1]
    if (cityId === last || game.path.includes(cityId)) return

    const conns = findConnections(last, cityId, data.holdings)
    if (conns.length === 0) {
      setGame((g) => ({
        ...g,
        lastError: `No nation held both ${data.cityById[last].name} and ${data.cityById[cityId].name} at the same time.`,
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
          currentYear={mode === 'game' ? game.connections[game.connections.length - 1]?.overlapEnd : undefined}
          paintMode={mode === 'paint'}
          paintYear={paintYear}
          holdings={data.holdings}
          empireColorById={data.empireColorById}
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
        />
      )}
      {mode === 'explore' && <ExplorePanel city={exploreCity} holdings={exploreHoldings} />}
      {mode === 'paint' && (
        <PaintControls
          holdings={data.holdings}
          empires={data.empires}
          minYear={data.minYear}
          maxYear={data.maxYear}
          year={paintYear}
          onYearChange={setPaintYear}
        />
      )}
    </div>
  )
}
