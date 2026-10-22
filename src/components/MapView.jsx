import { useState } from 'react'
import { MapContainer, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import ProvinceLayer from './ProvinceLayer.jsx'
import ReliefLayer, { OCEAN } from './ReliefLayer.jsx'

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

// City dots only show from this zoom level in; the start, target, path and selected dots always do.
const MIN_DOT_ZOOM = 5

function useZoom() {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  return zoom
}

function CityMarkers({ cities, startCity, targetCity, pathIds, selectedCityId, onCityClick }) {
  const zoomedIn = useZoom() >= MIN_DOT_ZOOM
  return cities.map((city) => {
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
    if (kind === 'default' && !zoomedIn) return null
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
  })
}

const WORLD_BOUNDS = [
  [-85.05, -180],
  [85.05, 180],
]

export default function MapView({
  cities,
  startCity,
  targetCity,
  pathIds,
  selectedCityId,
  onCityClick,
  paintMode,
  paintYear,
  holdings,
  colorAt,
}) {
  return (
    <MapContainer
      center={[45, 15]}
      zoom={5}
      minZoom={2}
      style={{ height: '100%', width: '100%', background: OCEAN }}
      worldCopyJump={false}
      maxBounds={WORLD_BOUNDS}
      maxBoundsViscosity={1.0}
    >
      {/* Shaded relief only: no modern borders or place names. */}
      <ReliefLayer
        attribution='Tiles &copy; Esri | UK &amp; Irish counties: <a href="https://www.county-borders.co.uk">Historic County Borders Project</a> | German districts &copy; EuroGeographics'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={13}
        noWrap
      />
      <ProvinceLayer
        paint={paintMode}
        year={paintYear}
        holdings={holdings}
        cities={cities}
        colorAt={colorAt}
        onProvinceClick={paintMode ? undefined : onCityClick}
      />
      {!paintMode && (
        <CityMarkers
          cities={cities}
          startCity={startCity}
          targetCity={targetCity}
          pathIds={pathIds}
          selectedCityId={selectedCityId}
          onCityClick={onCityClick}
        />
      )}
    </MapContainer>
  )
}
