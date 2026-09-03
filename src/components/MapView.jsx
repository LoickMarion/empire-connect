import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, GeoJSON } from 'react-leaflet'
import L from 'leaflet'
import { getBorderEras, getBorderEmpireMap } from '../data/dataSource.js'
import { pickEraForYear, loadEraGeoJSON } from '../data/borders.js'
import EmpireMapLayer from './EmpireMapLayer.jsx'

function markerIcon(kind) {
  const color =
    kind === 'start'
      ? '#2e7d32'
      : kind === 'target'
        ? '#c62828'
        : kind === 'path'
          ? '#6a1b9a'
          : kind === 'selected'
            ? '#ef6c00'
            : '#1565c0'
  return L.divIcon({
    className: 'city-marker',
    html: `<span style="background:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

const WORLD_BOUNDS = [
  [-90, -180],
  [90, 180],
]

function useBorderLayer(currentYear) {
  const [eras, setEras] = useState([])
  const [geojson, setGeojson] = useState(null)
  const [colorByName, setColorByName] = useState({})

  useEffect(() => {
    getBorderEras().then(setEras)
  }, [])

  useEffect(() => {
    if (eras.length === 0 || currentYear == null) return
    const era = pickEraForYear(eras, currentYear)
    if (!era) return
    let cancelled = false
    Promise.all([loadEraGeoJSON(era.file), getBorderEmpireMap(era.id)]).then(([data, mapping]) => {
      if (cancelled) return
      setGeojson(data)
      setColorByName(Object.fromEntries(mapping.map((m) => [m.featureName, m.color])))
    })
    return () => {
      cancelled = true
    }
  }, [eras, currentYear])

  return { geojson, colorByName }
}

export default function MapView({
  cities,
  startCity,
  targetCity,
  pathIds,
  selectedCityId,
  onCityClick,
  currentYear,
  paintMode,
  paintYear,
  holdings,
  empireColorById,
}) {
  const { geojson, colorByName } = useBorderLayer(paintMode ? null : currentYear)

  return (
    <MapContainer
      center={[45, 15]}
      zoom={4}
      minZoom={2}
      style={{ height: '100%', width: '100%' }}
      worldCopyJump={false}
      maxBounds={WORLD_BOUNDS}
      maxBoundsViscosity={1.0}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        noWrap
      />
      {paintMode && (
        <EmpireMapLayer cities={cities} holdings={holdings} empireColorById={empireColorById} year={paintYear} />
      )}
      {!paintMode && geojson && (
        <GeoJSON
          key={currentYear}
          data={geojson}
          style={(feature) => {
            const color = colorByName[feature.properties?.NAME]
            return color
              ? { color, weight: 1, fillColor: color, fillOpacity: 0.15 }
              : { color: '#999', weight: 0.5, fillOpacity: 0 }
          }}
        />
      )}
      {!paintMode &&
        cities.map((city) => {
          const kind =
            city.id === startCity
              ? 'start'
              : city.id === targetCity
                ? 'target'
                : pathIds.includes(city.id)
                  ? 'path'
                  : city.id === selectedCityId
                    ? 'selected'
                    : 'default'
          return (
            <Marker
              key={city.id}
              position={[city.lat, city.lon]}
              icon={markerIcon(kind)}
              eventHandlers={{ click: () => onCityClick(city.id) }}
            >
              <Tooltip>{city.name}</Tooltip>
            </Marker>
          )
        })}
    </MapContainer>
  )
}
