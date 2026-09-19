"use client";

import { useEffect } from "react";
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
}: BusinessMapProps) {
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
        <strong>{zip}</strong>
        <span>OpenStreetMap data</span>
      </div>
      <div className="map-caption">
        <span className="map-dot" />
        {located.length} mapped business{located.length === 1 ? "" : "es"} ·
        select a marker for details
      </div>
      {located.length === 0 && (
        <div className="map-empty">
          No businesses include coordinates yet.
        </div>
      )}
    </div>
  );
}
