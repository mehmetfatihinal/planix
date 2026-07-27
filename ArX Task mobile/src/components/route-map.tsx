import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "@/components/ui";
import type { RouteOpportunity } from "@/types/business";

export type RouteMapStop = {
  name: string;
  latitude: number;
  longitude: number;
};

type MapPayload = {
  origin: { latitude: number; longitude: number } | null;
  stops: RouteMapStop[];
  opportunities: Array<Pick<RouteOpportunity, "id" | "kind" | "title" | "latitude" | "longitude">>;
};

// Döşeme sağlayıcısı tek yerde: koyu tema istenirse
// "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" ile değiştirilir (ikisi de anahtarsız).
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "© OpenStreetMap";

function buildHtml(payload: MapPayload) {
  // `<` kaçışı, JSON içindeki bir dizginin script etiketini kapatmasını engeller.
  const data = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; background: ${colors.appBg}; }
  .pin { border-radius: 999px; display: flex; align-items: center; justify-content: center;
         font: 600 12px/1 -apple-system, Roboto, sans-serif; color: #fff; border: 2px solid rgba(0,0,0,0.35); }
  .pin-stop { background: ${colors.primary}; width: 26px; height: 26px; }
  .pin-task { background: ${colors.success}; width: 22px; height: 22px; }
  .pin-errand { background: ${colors.warning}; width: 22px; height: 22px; }
</style>
</head><body><div id="map"></div>
<script>
  var DATA = ${data};
  var map = L.map('map', { zoomControl: false });
  L.tileLayer('${TILE_URL}', { maxZoom: 19, attribution: '${TILE_ATTRIBUTION}' }).addTo(map);

  function icon(className, label) {
    return L.divIcon({
      className: '',
      html: '<div class="pin ' + className + '">' + label + '</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  var bounds = [];

  DATA.stops.forEach(function (stop, index) {
    L.marker([stop.latitude, stop.longitude], { icon: icon('pin-stop', String(index + 1)) })
      .addTo(map).bindTooltip(stop.name);
    bounds.push([stop.latitude, stop.longitude]);
  });

  if (DATA.stops.length > 1) {
    L.polyline(DATA.stops.map(function (stop) { return [stop.latitude, stop.longitude]; }),
      { color: '${colors.primary}', weight: 3, opacity: 0.85 }).addTo(map);
  }

  DATA.opportunities.forEach(function (item) {
    var className = item.kind === 'task' ? 'pin-task' : 'pin-errand';
    var label = item.kind === 'task' ? '\\u25CF' : '\\u25CB';
    L.marker([item.latitude, item.longitude], { icon: icon(className, label) })
      .addTo(map)
      .bindTooltip(item.title)
      .on('click', function () {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'opportunity', id: item.id }));
      });
    bounds.push([item.latitude, item.longitude]);
  });

  if (DATA.origin) {
    L.circleMarker([DATA.origin.latitude, DATA.origin.longitude],
      { radius: 6, color: '#ffffff', fillColor: '#ffffff', fillOpacity: 1 }).addTo(map);
    bounds.push([DATA.origin.latitude, DATA.origin.longitude]);
  }

  if (bounds.length > 1) { map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 }); }
  else if (bounds.length === 1) { map.setView(bounds[0], 13); }
  else { map.setView([39.0, 35.0], 5); }
</script></body></html>`;
}

export function RouteMap({
  origin,
  stops,
  opportunities,
  onSelectOpportunity
}: {
  origin: { latitude: number; longitude: number } | null;
  stops: RouteMapStop[];
  opportunities: RouteOpportunity[];
  onSelectOpportunity: (id: string) => void;
}) {
  const payload = useMemo<MapPayload>(
    () => ({
      origin,
      stops,
      opportunities: opportunities.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        latitude: item.latitude,
        longitude: item.longitude
      }))
    }),
    [opportunities, origin, stops]
  );

  const html = useMemo(() => buildHtml(payload), [payload]);
  // Veri değişince WebView'ı yeniden monte et — Leaflet katmanlarını elle
  // güncellemek yerine basit ve hatasız yol.
  // Anahtar duraklarınn koordinatlarını da içerir: durak sayısı aynı kalıp
  // firma değiştiğinde de harita tazelenmeli.
  const remountKey = useMemo(
    () =>
      [
        stops.map((stop) => `${stop.latitude},${stop.longitude}`).join("|"),
        opportunities.map((item) => item.id).join("|")
      ].join("#"),
    [opportunities, stops]
  );

  if (!stops.length && !opportunities.length) return null;

  return (
    <View style={styles.container}>
      <WebView
        key={remountKey}
        originWhitelist={["*"]}
        source={{ html }}
        javaScriptEnabled
        style={styles.web}
        // Harita yüklenemezse (ağ yok) sessizce boş kalır; liste kartı zaten var.
        onError={() => undefined}
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data) as { type?: string; id?: string };
            if (message.type === "opportunity" && message.id) onSelectOpportunity(message.id);
          } catch {
            // Yoksayılır.
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 240,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.appBg
  },
  web: {
    flex: 1,
    backgroundColor: colors.appBg
  }
});
