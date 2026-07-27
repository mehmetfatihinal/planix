import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDepartureSummary,
  distanceToCorridorMeters,
  findTaskOpportunities,
  type CompanySnapshot,
  type TaskSnapshot
} from "./route-opportunities";

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

const CORRIDOR = [
  { latitude: 39.9200, longitude: 32.8500 },
  { latitude: 39.9200, longitude: 32.9000 }
];

function company(id: string, latitude: number, longitude: number, name = id): CompanySnapshot {
  return { id, name, address: "adres", latitude, longitude };
}

function task(id: string, companyId: string | null, dueDate: string | null, title = id): TaskSnapshot {
  return { id, title, companyId, dueDate, dueTime: null, status: "open" };
}

test("koridora 1 km'den yakın firma girer, uzak olan elenir", () => {
  const near = company("near", 39.9250, 32.8750);   // ~555 m
  const far = company("far", 39.9400, 32.8750);     // ~2.2 km
  const result = findTaskOpportunities({
    tasks: [task("t1", "near", "2026-08-10"), task("t2", "far", "2026-08-10")],
    companies: [near, far],
    corridor: CORRIDOR,
    bufferMeters: 1000,
    excludeCompanyIds: [],
    limit: 6
  });
  assert.deepEqual(result.map((item) => item.companyId), ["near"]);
});

test("aynı firmadaki iki görev tek fırsata gruplanır, başlık en yakın vadeliden gelir", () => {
  const result = findTaskOpportunities({
    tasks: [
      task("t-late", "near", "2026-09-01", "Sonraki iş"),
      task("t-soon", "near", "2026-08-01", "Önceki iş")
    ],
    companies: [company("near", 39.9250, 32.8750)],
    corridor: CORRIDOR,
    bufferMeters: 1000,
    excludeCompanyIds: [],
    limit: 6
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.taskCount, 2);
  assert.equal(result[0]!.taskId, "t-soon");
  assert.equal(result[0]!.taskTitle, "Önceki iş");
});

test("tarihsiz görev en geç sayılır ama yine de fırsat üretir", () => {
  const result = findTaskOpportunities({
    tasks: [task("t-none", "near", null, "Tarihsiz")],
    companies: [company("near", 39.9250, 32.8750)],
    corridor: CORRIDOR,
    bufferMeters: 1000,
    excludeCompanyIds: [],
    limit: 6
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.taskTitle, "Tarihsiz");
});

test("bitmiş görev, firmasız görev ve koordinatsız firma elenir", () => {
  const result = findTaskOpportunities({
    tasks: [
      { ...task("done", "near", "2026-08-10"), status: "done" },
      task("no-company", null, "2026-08-10"),
      task("no-coords", "zero", "2026-08-10")
    ],
    companies: [company("near", 39.9250, 32.8750), company("zero", 0, 0)],
    corridor: CORRIDOR,
    bufferMeters: 1000,
    excludeCompanyIds: [],
    limit: 6
  });
  assert.deepEqual(result, []);
});

test("excludeCompanyIds içindeki firma çıkmaz", () => {
  const result = findTaskOpportunities({
    tasks: [task("t1", "near", "2026-08-10")],
    companies: [company("near", 39.9250, 32.8750)],
    corridor: CORRIDOR,
    bufferMeters: 1000,
    excludeCompanyIds: ["near"],
    limit: 6
  });
  assert.deepEqual(result, []);
});

test("bufferMeters null iken mesafe filtresi uygulanmaz, sıralama yine mesafeye göredir", () => {
  const result = findTaskOpportunities({
    tasks: [task("t-far", "far", "2026-08-10"), task("t-near", "near", "2026-08-10")],
    companies: [company("near", 39.9250, 32.8750), company("far", 40.5000, 32.8750)],
    corridor: [{ latitude: 39.9200, longitude: 32.8750 }],
    bufferMeters: null,
    excludeCompanyIds: [],
    limit: 6
  });
  assert.deepEqual(result.map((item) => item.companyId), ["near", "far"]);
});

test("limit aşılmaz", () => {
  const companies = [
    company("c1", 39.9210, 32.8600),
    company("c2", 39.9220, 32.8700),
    company("c3", 39.9230, 32.8800)
  ];
  const result = findTaskOpportunities({
    tasks: companies.map((item, index) => task(`t${index}`, item.id, "2026-08-10")),
    companies,
    corridor: CORRIDOR,
    bufferMeters: 1000,
    excludeCompanyIds: [],
    limit: 2
  });
  assert.equal(result.length, 2);
});

test("çıkış özeti: rota ve fırsat varken ikisini de sayar", () => {
  const summary = buildDepartureSummary({ stopCount: 4, taskOpportunityCount: 3, errandCount: 2 });
  assert.equal(summary.title, "Günaydın! Bugünkü rotanız hazır");
  assert.equal(summary.body, "4 durak · yol üzerinde 3 iş, 2 alışveriş");
});

test("çıkış özeti: rota var fırsat yokken mevcut metni korur", () => {
  const summary = buildDepartureSummary({ stopCount: 4, taskOpportunityCount: 0, errandCount: 0 });
  assert.equal(summary.body, "Bugünkü rotanız hazır — 4 durak");
});

test("çıkış özeti: rota yok fırsat varken yakındakileri duyurur", () => {
  const summary = buildDepartureSummary({ stopCount: 0, taskOpportunityCount: 3, errandCount: 0 });
  assert.equal(summary.title, "Bugün planlı göreviniz yok");
  assert.equal(summary.body, "Yakınınızda 3 açık iş var");
});

test("çıkış özeti: rota da fırsat da yokken mevcut metni korur", () => {
  const summary = buildDepartureSummary({ stopCount: 0, taskOpportunityCount: 0, errandCount: 0 });
  assert.equal(summary.title, "Günaydın!");
  assert.equal(summary.body, "Bugün planlı göreviniz yok.");
});
