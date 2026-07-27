import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceToCorridorMeters } from "./route-opportunities";

// Ankara civarında, 1 derece enlem ≈ 111 km. Kısa segmentlerde düzlemsel
// yaklaşıklamanın hatası ~%0.1 olduğu için toleranslar geniş tutuldu.
const A = { latitude: 39.9200, longitude: 32.8500 };
const B = { latitude: 39.9200, longitude: 32.9000 };

test("tek noktalı koridorda nokta-nokta mesafesine indirger", () => {
  const point = { latitude: 39.9290, longitude: 32.8500 }; // A'nın ~1 km kuzeyi
  const distance = distanceToCorridorMeters(point, [A]);
  assert.ok(Math.abs(distance - 1000) < 40, `beklenen ~1000 m, gelen ${distance}`);
});

test("segmentin ortasına dik mesafeyi bulur", () => {
  const point = { latitude: 39.9290, longitude: 32.8750 }; // segmentin ortasının ~1 km kuzeyi
  const distance = distanceToCorridorMeters(point, [A, B]);
  assert.ok(Math.abs(distance - 1000) < 40, `beklenen ~1000 m, gelen ${distance}`);
});

test("segment dışındaki nokta uç noktaya kilitlenir", () => {
  const point = { latitude: 39.9200, longitude: 32.8000 }; // A'nın ~4.3 km batısı
  const distance = distanceToCorridorMeters(point, [A, B]);
  const direct = distanceToCorridorMeters(point, [A]);
  assert.ok(Math.abs(distance - direct) < 5, "uç noktaya kilitlenmeli");
});

test("boş koridor sonsuz döner", () => {
  assert.equal(distanceToCorridorMeters(A, []), Number.POSITIVE_INFINITY);
});

test("çok segmentli koridorda en yakın segmenti seçer", () => {
  const C = { latitude: 40.0000, longitude: 32.9000 };
  const point = { latitude: 39.9290, longitude: 32.8750 };
  const distance = distanceToCorridorMeters(point, [A, B, C]);
  assert.ok(Math.abs(distance - 1000) < 40, `beklenen ~1000 m, gelen ${distance}`);
});
