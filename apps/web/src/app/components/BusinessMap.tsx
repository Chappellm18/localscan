"use client";

import { useEffect, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

export type MapResult = {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
};

type BusinessMapProps = {
  results: MapResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  zip: string;
  dataUnavailable: boolean;
  isLoading: boolean;
};

function MapViewport({ results }: { results: MapResult[] }) {
  const map = useMap();

  useEffect(() => {
    const located = results.filter(
      (result): result is MapResult & { lat: number; lng: number } =>
        result.lat !== null && result.lng !== null,
    );
    if (located.length === 0) return;

    const bounds: LatLngBoundsExpression = located.map((result) => [
      result.lat,
      result.lng,
    ]);
    map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15 });
  }, [map, results]);

  return null;
}

export default function BusinessMap({
  results,
  selectedId,
  onSelect,
  zip,
  dataUnavailable,
  isLoading,
}: BusinessMapProps) {
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const located = results.filter(
    (result): result is MapResult & { lat: number; lng: number } =>
      result.lat !== null && result.lng !== null,
  );
  const center: [number, number] = located.length
    ? [located[0].lat, located[0].lng]
    : [39.8283, -98.5795];

  return (
    <div className="osm-map-wrap">
      <MapContainer
        center={center}
        className="osm-map"
        scrollWheelZoom
        zoom={located.length ? 13 : 4}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          eventHandlers={{ tileerror: () => setTilesUnavailable(true) }}
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapViewport results={results} />
        {located.map((result, index) => {
          const isSelected = result.id === selectedId;
          return (
            <CircleMarker
              center={[result.lat, result.lng]}
              fillColor={isSelected ? "#809d26" : "#193d2e"}
              fillOpacity={1}
              key={result.id}
              radius={isSelected ? 11 : 8}
              color="#fff"
              weight={isSelected ? 3 : 2}
              eventHandlers={{ click: () => onSelect(result.id) }}
            >
              <Popup>
                <strong>{index + 1}. {result.name}</strong>
                <br />
                <span>{result.address ?? "Address unavailable"}</span>
                <br />
                <button
                  className="map-popup-button"
                  onClick={() => onSelect(result.id)}
                  type="button"
                >
                  View details
                </button>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="map-location-label">
        <strong>ZIP {zip}</strong>
        <span>{located.length > 0 ? "Business locations" : "Location unavailable"}</span>
      </div>
      {tilesUnavailable && (
        <div className="map-tile-warning" role="status">
          Map tiles are unavailable. Your business data is still shown where possible.
        </div>
      )}
      <div className="map-caption">
        <span className="map-dot" />
        {located.length > 0
          ? `${located.length} mapped business${located.length === 1 ? "" : "es"} · select a marker for details`
          : "No business locations available"}
      </div>
      {located.length === 0 && (
        <div className="map-empty" role={isLoading ? "status" : undefined}>
          <span className="empty-mark" aria-hidden="true">{isLoading ? "…" : dataUnavailable ? "!" : results.length > 0 ? "↗" : "0"}</span>
          <strong>{isLoading ? "Loading business locations" : dataUnavailable ? "Business details unavailable" : results.length > 0 ? "No map locations yet" : "No businesses to map yet"}</strong>
          <p>{isLoading ? "The search is complete. We’re getting the details ready." : dataUnavailable ? "We couldn’t retrieve this search’s business details. Try again from the results list." : results.length > 0 ? "Businesses were found, but none include coordinates. You can still review them in the list." : "When local businesses are found, their available locations will appear here."}</p>
        </div>
      )}
    </div>
  );
}
