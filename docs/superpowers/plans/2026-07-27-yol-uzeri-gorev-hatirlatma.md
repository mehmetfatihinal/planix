# Yol Üzeri Görev Hatırlatma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kullanıcı yola çıktığında (evden çıkışta otomatik veya manuel rota başlatmada) güzergâhının 1 km'lik koridorundaki açık görev firmalarını ve alışveriş dükkanlarını hatırlatmak; böylece aynı iş için ikinci bir sefer gerekmemesi.

**Architecture:** Görev fırsatları **cihazda** hesaplanır (veri zaten AsyncStorage'da, ağ gerekmez, headless çıkışta garanti çalışır); alışveriş dükkanları mevcut `/route/errand-stops` ucundan gelir ve "best-effort"tur. Fırsatlar OS geofence'i olarak kurulur, yaklaşınca bildirim çıkar; Rota planı ekranında liste + uygulama içi OSM haritası olarak gösterilir ama **rotaya zorunlu durak olarak eklenmez**.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / TypeScript (strict), expo-location (geofencing), expo-notifications, expo-task-manager, AsyncStorage, react-native-webview + Leaflet 1.9.4 + OpenStreetMap, `node --test` + `tsx` (yeni test koşucusu).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-yol-uzeri-gorev-hatirlatma-design.md` — çelişki hâlinde spec kazanır.
- Çalışma dizini: mobil uygulama için **`ArX Task mobile/`**. Bu plandaki tüm göreli yollar o klasöre göredir.
- **Sunucu tarafı değişmez.** `api/ArxTask.Api/Program.cs` ve tüm .NET kodu bu planın dışındadır.
- Koridor tamponu: **1000 m**. Bölge sınırları: yol üzeri görev fırsatı **maks 6**, alışveriş **maks 8**, toplam OS bölgesi **20**.
- Anlık görüntü sınırı: `MAX_OPEN_TASK_SNAPSHOT = 300`.
- Bekleme süreleri: `company` **4 saat**, `task-opportunity` / `errand` / `seller` **24 saat**.
- Bölge kimliği ön ekleri: mevcut `seller:` ve `errand:` korunur, yeni `opp:` eklenir.
- Headless kod (`TaskManager.defineTask` gövdesi ve çağırdığı her şey) **asla hata fırlatmaz** — mevcut `try/catch` kalıbı korunur.
- Yeni saf modüller (`route-opportunities.ts`, `geofence-throttle-state.ts`) yalnızca `import type` kullanır; çalışma zamanı importu (AsyncStorage, expo-*, React) **yasaktır** — test koşucusu bunları çözemez.
- TypeScript `strict: true`. Her görevin sonunda `npm run typecheck` temiz olmalı.
- Kullanıcıya görünen tüm yeni metinler `src/lib/i18n.tsx` içindeki **6 dilin tamamına** eklenir: `en`, `de`, `tr`, `ar`, `fr`, `nl`.
- Bildirim metinleri Türkçe sabittir (mevcut geofence bildirimleri de öyle, `geofencing.ts:146-168`); yalnızca ekran metinleri i18n'den geçer.

---

## File Structure

**Yeni dosyalar**

| Dosya | Sorumluluk |
|---|---|
| `src/lib/route-opportunities.ts` | Saf geometri + seçim: koridor mesafesi, fırsat bulma, çıkış özeti metni. Çalışma zamanı bağımlılığı yok. |
| `src/lib/route-opportunities.test.ts` | Yukarıdakinin birim testleri. |
| `src/lib/geofence-throttle-state.ts` | Saf bildirim kısıtlama durumu: bekleme süreleri, "bildirilebilir mi", durum geçişleri, gün anahtarı. |
| `src/lib/geofence-throttle-state.test.ts` | Yukarıdakinin birim testleri. |
| `src/lib/geofence-throttle.ts` | AsyncStorage sarmalayıcı: `shouldNotify` / `markNotified` / `muteRegionForToday`. |
| `src/components/route-map.tsx` | WebView + Leaflet haritası; duraklar, rota çizgisi, fırsat pinleri, pin dokunma mesajı. |

> Spec §12 tek bir `geofence-throttle.ts` öngörüyordu. Test edilebilirlik için saf durum mantığı
> `geofence-throttle-state.ts`'e ayrıldı — I/O'suz olduğu için birim testi yazılabiliyor. Davranış aynı.

**Değişen dosyalar**

| Dosya | Değişiklik |
|---|---|
| `src/lib/geofencing.ts` | Yeni depolar + `resyncGeofences`, `opp:` bölge türü ve bildirimi, throttle kapısı, genişleyen `persistAutoRouteInputs`, yeni `handleHomeExit` akışı |
| `src/lib/app-data-context.tsx` | `rebuildGeofences` içinde en-yakın-N modu, `fetchRouteErrands` sonucunun fırsat deposuna yazılması |
| `src/lib/notifications.ts` | `geofence-reminder` kategorisi + `mute-today` eylemi |
| `app/(app)/route-planner.tsx` | "Yol üzerinde" kartı, harita, genelleşen fırsat modalı, `manualExtraStops` |
| `src/lib/i18n.tsx` | Yeni ekran metinleri (6 dil) |
| `package.json` | `react-native-webview` bağımlılığı, `tsx` devDependency, `test:logic` script'i |

---

## Task 1: Test koşucusu + koridor mesafesi

**Files:**
- Modify: `package.json`
- Create: `src/lib/route-opportunities.ts`
- Test: `src/lib/route-opportunities.test.ts`

**Interfaces:**
- Consumes: yok (ilk görev)
- Produces:
  - `type Coordinate = { latitude: number; longitude: number }`
  - `type Corridor = Coordinate[]`
  - `function hasUsableCoordinates(latitude?: number | null, longitude?: number | null): boolean`
  - `function haversineMeters(origin: Coordinate, destination: Coordinate): number`
  - `function distanceToCorridorMeters(point: Coordinate, corridor: Corridor): number`
  - `npm run test:logic` komutu

- [ ] **Step 1: Test koşucusunu kur**

`ArX Task mobile/package.json` içinde `scripts` bloğuna ekle ve `devDependencies` bloğu oluştur
(dosyada şu an `devDependencies` yok; `dependencies` bloğundan sonra ekle):

```json
  "scripts": {
    "start": "expo start --localhost",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "typecheck": "tsc --noEmit",
    "test:logic": "node --test --import tsx \"src/lib/*.test.ts\""
  },
```

```json
  "devDependencies": {
    "tsx": "^4.19.2"
  }
```

Sonra: `npm install`

`node --import` Node 20.6+ ister; ortamda Node 26 var, uyumlu.

- [ ] **Step 2: Başarısız testi yaz**

`src/lib/route-opportunities.test.ts`:

```ts
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
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu doğrula**

Çalıştır: `npm run test:logic`
Beklenen: FAIL — `Cannot find module './route-opportunities'`

- [ ] **Step 4: Minimum implementasyonu yaz**

`src/lib/route-opportunities.ts`:

```ts
// Yol üzeri fırsat mantığı. BU DOSYA SAF TUTULMALI: çalışma zamanı importu yok,
// yalnızca `import type`. Birim testleri Expo/React Native olmadan çalışır.

export type Coordinate = { latitude: number; longitude: number };
export type Corridor = Coordinate[];

const EARTH_RADIUS_METERS = 6_371_000;

export function hasUsableCoordinates(latitude?: number | null, longitude?: number | null) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) > 0.000001 &&
    Math.abs(longitude) > 0.000001
  );
}

export function haversineMeters(origin: Coordinate, destination: Coordinate) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(destination.latitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type PlanarPoint = { x: number; y: number };

// Ekvatoral izdüşüm: referans enlemde metreye çevirir. Şehir içi mesafelerde
// hata payı ihmal edilebilir; segment matematiğini düzlemsel yapabilmek için.
function toPlanar(point: Coordinate, anchorLatitudeRadians: number): PlanarPoint {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  return {
    x: toRadians(point.longitude) * Math.cos(anchorLatitudeRadians) * EARTH_RADIUS_METERS,
    y: toRadians(point.latitude) * EARTH_RADIUS_METERS
  };
}

function distancePointToSegment(point: PlanarPoint, start: PlanarPoint, end: PlanarPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

// Bir noktanın, ardışık duraklardan oluşan çoklu-çizgiye en kısa mesafesi.
// Tek noktalı koridorda düz nokta-nokta mesafesine indirger.
export function distanceToCorridorMeters(point: Coordinate, corridor: Corridor): number {
  if (corridor.length === 0) return Number.POSITIVE_INFINITY;
  if (corridor.length === 1) return haversineMeters(point, corridor[0]!);

  const anchor = (point.latitude * Math.PI) / 180;
  const planarPoint = toPlanar(point, anchor);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corridor.length - 1; index += 1) {
    const start = toPlanar(corridor[index]!, anchor);
    const end = toPlanar(corridor[index + 1]!, anchor);
    best = Math.min(best, distancePointToSegment(planarPoint, start, end));
  }
  return best;
}
```

- [ ] **Step 5: Testi çalıştır, geçtiğini doğrula**

Çalıştır: `npm run test:logic`
Beklenen: PASS — 5 test

- [ ] **Step 6: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 7: Commit**

```bash
git add "ArX Task mobile/package.json" "ArX Task mobile/package-lock.json" "ArX Task mobile/src/lib/route-opportunities.ts" "ArX Task mobile/src/lib/route-opportunities.test.ts"
git commit -m "feat(mobile): koridor mesafesi hesabi ve saf mantik test kosucusu"
```

---

## Task 2: Fırsat bulma ve çıkış özeti metni

**Files:**
- Modify: `src/lib/route-opportunities.ts`
- Test: `src/lib/route-opportunities.test.ts`

**Interfaces:**
- Consumes: Task 1'den `distanceToCorridorMeters`, `hasUsableCoordinates`, `Coordinate`, `Corridor`
- Produces:
  - `type TaskSnapshot = Pick<Task, "id" | "title" | "companyId" | "dueDate" | "dueTime" | "status">`
  - `type CompanySnapshot = Pick<Company, "id" | "name" | "address" | "latitude" | "longitude">`
  - `type TaskOpportunity = { companyId; companyName; latitude; longitude; taskId; taskTitle; taskCount; distanceToRouteMeters }`
  - `const ON_THE_WAY_BUFFER_METERS = 1000`
  - `const MAX_TASK_OPPORTUNITY_REGIONS = 6`
  - `const MAX_OPEN_TASK_SNAPSHOT = 300`
  - `function findTaskOpportunities(input): TaskOpportunity[]`
  - `function buildDepartureSummary(input): { title: string; body: string }`

- [ ] **Step 1: Başarısız testleri yaz**

`src/lib/route-opportunities.test.ts` dosyasının **sonuna** ekle. Üst kısımdaki import satırını da güncelle:

```ts
import {
  buildDepartureSummary,
  distanceToCorridorMeters,
  findTaskOpportunities,
  type CompanySnapshot,
  type TaskSnapshot
} from "./route-opportunities";
```

```ts
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
```

- [ ] **Step 2: Testleri çalıştır, başarısız olduklarını doğrula**

Çalıştır: `npm run test:logic`
Beklenen: FAIL — `findTaskOpportunities is not a function` (Task 1 testleri geçmeye devam eder)

- [ ] **Step 3: Implementasyonu yaz**

`src/lib/route-opportunities.ts` dosyasının **başına** tip importunu ekle:

```ts
import type { Company, Task } from "@/types/business";
```

Dosyanın **sonuna** ekle:

```ts
export type TaskSnapshot = Pick<Task, "id" | "title" | "companyId" | "dueDate" | "dueTime" | "status">;
export type CompanySnapshot = Pick<Company, "id" | "name" | "address" | "latitude" | "longitude">;

export type TaskOpportunity = {
  companyId: string;
  companyName: string;
  latitude: number;
  longitude: number;
  taskId: string;      // firmadaki en yakın vadeli görev
  taskTitle: string;
  taskCount: number;   // firmadaki açık görev sayısı
  distanceToRouteMeters: number;
};

export const ON_THE_WAY_BUFFER_METERS = 1000;
export const MAX_TASK_OPPORTUNITY_REGIONS = 6;
export const MAX_OPEN_TASK_SNAPSHOT = 300;

export function taskSortKey(task: Pick<TaskSnapshot, "dueDate" | "dueTime">) {
  return `${task.dueDate ?? "9999-12-31"}T${task.dueTime ?? "23:59"}`;
}

// Koridora yakın, açık görev taşıyan firmaları bulur. bufferMeters null ise
// mesafe filtresi uygulanmaz (rotasız gün: konuma en yakın N firma).
export function findTaskOpportunities(input: {
  tasks: TaskSnapshot[];
  companies: CompanySnapshot[];
  corridor: Corridor;
  bufferMeters: number | null;
  excludeCompanyIds: string[];
  limit: number;
}): TaskOpportunity[] {
  const { tasks, companies, corridor, bufferMeters, excludeCompanyIds, limit } = input;
  if (!corridor.length || limit <= 0) return [];

  const excluded = new Set(excludeCompanyIds);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const groups = new Map<string, { company: CompanySnapshot; tasks: TaskSnapshot[] }>();

  for (const task of tasks) {
    if (task.status === "done" || !task.companyId) continue;
    if (excluded.has(task.companyId)) continue;
    const company = companyById.get(task.companyId);
    if (!company || !hasUsableCoordinates(company.latitude, company.longitude)) continue;
    const group = groups.get(company.id) ?? { company, tasks: [] };
    group.tasks.push(task);
    groups.set(company.id, group);
  }

  const opportunities: TaskOpportunity[] = [];
  for (const group of groups.values()) {
    const distance = distanceToCorridorMeters(
      { latitude: group.company.latitude, longitude: group.company.longitude },
      corridor
    );
    if (bufferMeters !== null && distance > bufferMeters) continue;
    const soonest = group.tasks
      .slice()
      .sort((left, right) => taskSortKey(left).localeCompare(taskSortKey(right)))[0]!;
    opportunities.push({
      companyId: group.company.id,
      companyName: group.company.name,
      latitude: group.company.latitude,
      longitude: group.company.longitude,
      taskId: soonest.id,
      taskTitle: soonest.title,
      taskCount: group.tasks.length,
      distanceToRouteMeters: Math.round(distance)
    });
  }

  opportunities.sort((left, right) =>
    left.distanceToRouteMeters !== right.distanceToRouteMeters
      ? left.distanceToRouteMeters - right.distanceToRouteMeters
      : left.companyName.localeCompare(right.companyName, "tr")
  );

  return opportunities.slice(0, limit);
}

// Evden çıkış özet bildiriminin metni. Rota veya fırsat yoksa mevcut
// metinler korunur (geofencing.ts:193, :226).
export function buildDepartureSummary(input: {
  stopCount: number;
  taskOpportunityCount: number;
  errandCount: number;
}): { title: string; body: string } {
  const { stopCount, taskOpportunityCount, errandCount } = input;
  const extras: string[] = [];
  if (taskOpportunityCount > 0) extras.push(`yol üzerinde ${taskOpportunityCount} iş`);
  if (errandCount > 0) extras.push(`${errandCount} alışveriş`);

  if (stopCount > 0) {
    return {
      title: "Günaydın! Bugünkü rotanız hazır",
      body: extras.length
        ? `${stopCount} durak · ${extras.join(", ")}`
        : `Bugünkü rotanız hazır — ${stopCount} durak`
    };
  }

  if (taskOpportunityCount > 0) {
    return {
      title: "Bugün planlı göreviniz yok",
      body: `Yakınınızda ${taskOpportunityCount} açık iş var`
    };
  }

  return { title: "Günaydın!", body: "Bugün planlı göreviniz yok." };
}
```

- [ ] **Step 4: Testleri çalıştır, geçtiklerini doğrula**

Çalıştır: `npm run test:logic`
Beklenen: PASS — 16 test

- [ ] **Step 5: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 6: Commit**

```bash
git add "ArX Task mobile/src/lib/route-opportunities.ts" "ArX Task mobile/src/lib/route-opportunities.test.ts"
git commit -m "feat(mobile): yol uzeri gorev firsati secimi ve cikis ozeti metni"
```

---

## Task 3: Bildirim kısıtlama (throttle)

**Files:**
- Create: `src/lib/geofence-throttle-state.ts`
- Create: `src/lib/geofence-throttle.ts`
- Test: `src/lib/geofence-throttle-state.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `type GeofenceKind = "company" | "task-opportunity" | "errand" | "seller"`
  - `type ThrottleState = { date: string; entries: Record<string, { lastNotifiedAt: number; muted: boolean }> }`
  - `function todayKeyLocal(now: Date): string`
  - `function normalizeState(state: ThrottleState | null, todayKey: string): ThrottleState`
  - `function canNotify(state, regionId, kind, nowMs): boolean`
  - `function withNotified(state, regionId, nowMs): ThrottleState`
  - `function withMuted(state, regionId, nowMs): ThrottleState`
  - `async function shouldNotify(regionId: string, kind: GeofenceKind): Promise<boolean>`
  - `async function markNotified(regionId: string): Promise<void>`
  - `async function muteRegionForToday(regionId: string): Promise<void>`

- [ ] **Step 1: Başarısız testi yaz**

`src/lib/geofence-throttle-state.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canNotify,
  emptyState,
  normalizeState,
  todayKeyLocal,
  withMuted,
  withNotified
} from "./geofence-throttle-state";

const HOUR = 60 * 60 * 1000;
const TODAY = "2026-07-27";
const NOW = 1_800_000_000_000;

test("todayKeyLocal yerel tarihi YYYY-MM-DD verir", () => {
  assert.equal(todayKeyLocal(new Date(2026, 6, 27, 9, 30)), "2026-07-27");
  assert.equal(todayKeyLocal(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("hiç kaydı olmayan bölge bildirilebilir", () => {
  assert.equal(canNotify(emptyState(TODAY), "opp:a", "task-opportunity", NOW), true);
});

test("gün değişince durum sıfırlanır", () => {
  const yesterday = withNotified(emptyState("2026-07-26"), "opp:a", NOW);
  const normalized = normalizeState(yesterday, TODAY);
  assert.deepEqual(normalized, emptyState(TODAY));
  assert.equal(canNotify(normalized, "opp:a", "task-opportunity", NOW), true);
});

test("yol üzeri fırsat günde bir kez bildirilir", () => {
  const state = withNotified(emptyState(TODAY), "opp:a", NOW);
  assert.equal(canNotify(state, "opp:a", "task-opportunity", NOW + 6 * HOUR), false);
  assert.equal(canNotify(state, "opp:a", "task-opportunity", NOW + 25 * HOUR), true);
});

test("bugünün görev firması 4 saat sonra tekrar bildirilir", () => {
  const state = withNotified(emptyState(TODAY), "company-1", NOW);
  assert.equal(canNotify(state, "company-1", "company", NOW + 3 * HOUR), false);
  assert.equal(canNotify(state, "company-1", "company", NOW + 4 * HOUR), true);
});

test("susturulan bölge süre dolsa da bildirilmez", () => {
  const state = withMuted(withNotified(emptyState(TODAY), "opp:a", NOW), "opp:a", NOW);
  assert.equal(canNotify(state, "opp:a", "task-opportunity", NOW + 48 * HOUR), false);
});

test("susturma diğer bölgeleri etkilemez", () => {
  const state = withMuted(emptyState(TODAY), "opp:a", NOW);
  assert.equal(canNotify(state, "opp:b", "task-opportunity", NOW), true);
});

test("withNotified mevcut susturmayı bozmaz", () => {
  const state = withNotified(withMuted(emptyState(TODAY), "opp:a", NOW), "opp:a", NOW + HOUR);
  assert.equal(state.entries["opp:a"]!.muted, true);
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu doğrula**

Çalıştır: `npm run test:logic`
Beklenen: FAIL — `Cannot find module './geofence-throttle-state'`

- [ ] **Step 3: Saf durum modülünü yaz**

`src/lib/geofence-throttle-state.ts`:

```ts
// Geofence bildirimlerinin tekrar kontrolü — SAF mantık. Çalışma zamanı importu yok.
// I/O sarmalayıcısı: geofence-throttle.ts

export type GeofenceKind = "company" | "task-opportunity" | "errand" | "seller";

export type ThrottleEntry = { lastNotifiedAt: number; muted: boolean };
export type ThrottleState = { date: string; entries: Record<string, ThrottleEntry> };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Bugünün görevi bugün bitmeli: sabah geçip yapmadıysan akşam tekrar hatırlatmak
// değerli. Yol üzeri fırsatların tarihi bugün değil — ikinci bildirim gürültü.
export const COOLDOWN_BY_KIND: Record<GeofenceKind, number> = {
  company: 4 * HOUR,
  "task-opportunity": DAY,
  errand: DAY,
  seller: DAY
};

export function todayKeyLocal(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function emptyState(todayKey: string): ThrottleState {
  return { date: todayKey, entries: {} };
}

export function normalizeState(state: ThrottleState | null, todayKey: string): ThrottleState {
  if (!state || state.date !== todayKey || typeof state.entries !== "object" || state.entries === null) {
    return emptyState(todayKey);
  }
  return state;
}

export function canNotify(
  state: ThrottleState,
  regionId: string,
  kind: GeofenceKind,
  nowMs: number
): boolean {
  const entry = state.entries[regionId];
  if (!entry) return true;
  if (entry.muted) return false;
  return nowMs - entry.lastNotifiedAt >= COOLDOWN_BY_KIND[kind];
}

export function withNotified(state: ThrottleState, regionId: string, nowMs: number): ThrottleState {
  const previous = state.entries[regionId];
  return {
    ...state,
    entries: {
      ...state.entries,
      [regionId]: { lastNotifiedAt: nowMs, muted: previous?.muted ?? false }
    }
  };
}

export function withMuted(state: ThrottleState, regionId: string, nowMs: number): ThrottleState {
  const previous = state.entries[regionId];
  return {
    ...state,
    entries: {
      ...state.entries,
      [regionId]: { lastNotifiedAt: previous?.lastNotifiedAt ?? nowMs, muted: true }
    }
  };
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini doğrula**

Çalıştır: `npm run test:logic`
Beklenen: PASS — 24 test (Task 1-2'nin 16'sı + 8 yeni)

- [ ] **Step 5: AsyncStorage sarmalayıcısını yaz**

`src/lib/geofence-throttle.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  canNotify,
  normalizeState,
  todayKeyLocal,
  withMuted,
  withNotified,
  type GeofenceKind,
  type ThrottleState
} from "@/lib/geofence-throttle-state";

const THROTTLE_KEY = "arx:geofence-notified";

async function readState(): Promise<ThrottleState> {
  const todayKey = todayKeyLocal(new Date());
  try {
    const raw = await AsyncStorage.getItem(THROTTLE_KEY);
    return normalizeState(raw ? (JSON.parse(raw) as ThrottleState) : null, todayKey);
  } catch {
    return normalizeState(null, todayKey);
  }
}

async function writeState(state: ThrottleState) {
  try {
    await AsyncStorage.setItem(THROTTLE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort — kısıtlama kaybı bildirimi engellemekten iyidir.
  }
}

export async function shouldNotify(regionId: string, kind: GeofenceKind): Promise<boolean> {
  const state = await readState();
  return canNotify(state, regionId, kind, Date.now());
}

export async function markNotified(regionId: string): Promise<void> {
  const state = await readState();
  await writeState(withNotified(state, regionId, Date.now()));
}

export async function muteRegionForToday(regionId: string): Promise<void> {
  const state = await readState();
  await writeState(withMuted(state, regionId, Date.now()));
}
```

- [ ] **Step 6: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 7: Commit**

```bash
git add "ArX Task mobile/src/lib/geofence-throttle-state.ts" "ArX Task mobile/src/lib/geofence-throttle-state.test.ts" "ArX Task mobile/src/lib/geofence-throttle.ts"
git commit -m "feat(mobile): geofence bildirimleri icin tekrar kontrolu"
```

---

## Task 4: Fırsat deposu, sync girdisi kalıcılığı ve `resyncGeofences`

**Files:**
- Modify: `src/lib/geofencing.ts`

**Interfaces:**
- Consumes: Task 2'den `TaskOpportunity`, `MAX_TASK_OPPORTUNITY_REGIONS`, `MAX_OPEN_TASK_SNAPSHOT`, `taskSortKey`
- Produces:
  - `type StoredTaskOpportunities = { date: string; source: "route" | "nearby"; items: TaskOpportunity[] }`
  - `async function persistTaskOpportunities(payload: StoredTaskOpportunities): Promise<void>`
  - `async function loadStoredTaskOpportunities(): Promise<StoredTaskOpportunities | null>`
  - `async function loadTaskOpportunities(todayKey: string): Promise<TaskOpportunity[]>`
  - `async function resyncGeofences(): Promise<void>`
  - `persistAutoRouteInputs` artık **tüm açık görevleri** saklar

- [ ] **Step 1: Sabitleri ve depo anahtarlarını ekle**

`src/lib/geofencing.ts` — mevcut sabitlerin (satır 17-29) yanına ekle:

```ts
const TASK_OPPORTUNITIES_KEY = "arx:task-opportunities";
const SYNC_INPUT_KEY = "arx:geofence-sync-input";
const TASK_OPPORTUNITY_PREFIX = "opp:";
```

Dosyanın import bloğuna ekle:

```ts
import {
  MAX_OPEN_TASK_SNAPSHOT,
  MAX_TASK_OPPORTUNITY_REGIONS,
  taskSortKey,
  type TaskOpportunity
} from "@/lib/route-opportunities";
```

- [ ] **Step 2: `GeofenceMapEntry` birliğine yeni türü ekle**

`src/lib/geofencing.ts:59-62` içindeki birliği şununla değiştir:

```ts
type GeofenceMapEntry =
  | { kind: "company"; companyName: string; taskTitle: string; taskId: string; taskCount: number }
  | { kind: "task-opportunity"; companyName: string; taskTitle: string; taskId: string; taskCount: number }
  | { kind: "seller"; itemName: string; companyName: string }
  | { kind: "errand"; itemName: string; shopName: string };
```

- [ ] **Step 3: Fırsat deposunu yaz**

`src/lib/geofencing.ts` — `loadErrandGeofences` fonksiyonundan (satır 296) sonra ekle:

```ts
// Yol üzeri görev fırsatları. `source: "route"` evden çıkış / manuel rota
// başlatmadan gelir ve gün içinde veri senkronuyla ezilmez; `source: "nearby"`
// rota yokken konuma en yakın firmalardan üretilir.
export type StoredTaskOpportunities = {
  date: string;
  source: "route" | "nearby";
  items: TaskOpportunity[];
};

export async function persistTaskOpportunities(payload: StoredTaskOpportunities) {
  try {
    if (!payload.items.length) {
      await AsyncStorage.removeItem(TASK_OPPORTUNITIES_KEY);
      return;
    }
    await AsyncStorage.setItem(
      TASK_OPPORTUNITIES_KEY,
      JSON.stringify({ ...payload, items: payload.items.slice(0, MAX_TASK_OPPORTUNITY_REGIONS) })
    );
  } catch {
    // Best-effort.
  }
}

export async function loadStoredTaskOpportunities(): Promise<StoredTaskOpportunities | null> {
  try {
    const raw = await AsyncStorage.getItem(TASK_OPPORTUNITIES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTaskOpportunities;
    return Array.isArray(parsed?.items) ? parsed : null;
  } catch {
    return null;
  }
}

// Yalnızca bugüne ait kaydı döner; tarih değişmişse kayıt geçersizdir.
export async function loadTaskOpportunities(todayKey: string): Promise<TaskOpportunity[]> {
  const stored = await loadStoredTaskOpportunities();
  if (!stored || stored.date !== todayKey) return [];
  return stored.items.slice(0, MAX_TASK_OPPORTUNITY_REGIONS);
}
```

- [ ] **Step 4: `persistAutoRouteInputs`'i tüm açık görevlere genişlet**

`src/lib/geofencing.ts:66-70` içindeki `AutoRouteInputs` tipinin yorumunu güncelle ve
`persistAutoRouteInputs` (satır 250) gövdesini şununla değiştir:

```ts
// Headless çıkış işleyicisinin ihtiyaç duyduğu asgari girdiyi saklar.
// Bugünün görevleri değil, companyId taşıyan TÜM açık görevler saklanır —
// yol üzeri fırsatlar tarih bağımsız değerlendirilir.
export async function persistAutoRouteInputs(tasks: Task[], companies: Company[]) {
  try {
    const openTasks = tasks
      .filter((task) => task.status !== "done" && Boolean(task.companyId))
      .sort((left, right) => taskSortKey(left).localeCompare(taskSortKey(right)))
      .slice(0, MAX_OPEN_TASK_SNAPSHOT);

    const inputs: AutoRouteInputs = {
      todayKey: todayKeyLocal(),
      tasks: openTasks.map((task) => ({
        id: task.id,
        title: task.title,
        companyId: task.companyId,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        status: task.status
      })),
      companies: companies.map((company) => ({
        id: company.id,
        name: company.name,
        address: company.address,
        latitude: company.latitude,
        longitude: company.longitude
      }))
    };
    await AsyncStorage.setItem(AUTO_ROUTE_INPUTS_KEY, JSON.stringify(inputs));
  } catch {
    // Best-effort.
  }
}
```

- [ ] **Step 5: `syncGeofences` girdisini sakla ve `resyncGeofences` ekle**

`src/lib/geofencing.ts` — `syncGeofences` gövdesinin **ilk satırı** olarak (satır 313'teki
`try {`'in hemen içine) girdiyi sakla:

```ts
    await AsyncStorage.setItem(SYNC_INPUT_KEY, JSON.stringify(input)).catch(() => undefined);
```

Ve `syncGeofences` fonksiyonundan sonra ekle:

```ts
// Headless uyanmada React ağacı yok; son sync girdisini diskten okuyup bölgeleri
// yeniden kurar. Fırsat ve errand listeleri kendi depolarından okunduğu için
// bu çağrı onların en güncel hâlini kullanır.
export async function resyncGeofences() {
  try {
    const raw = await AsyncStorage.getItem(SYNC_INPUT_KEY);
    if (!raw) return;
    const input = JSON.parse(raw) as SyncGeofencesInput;
    if (!input || !Array.isArray(input.companies)) return;
    await syncGeofences(input);
  } catch {
    // Best-effort.
  }
}
```

- [ ] **Step 6: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 7: Commit**

```bash
git add "ArX Task mobile/src/lib/geofencing.ts"
git commit -m "feat(mobile): firsat deposu, sync girdisi kaliciligi ve resyncGeofences"
```

---

## Task 5: "Bugün sorma" bildirim eylemi

**Files:**
- Modify: `src/lib/notifications.ts:144-160` (kategoriler), `src/lib/notifications.ts:402-436` (eylem işleyici)

**Interfaces:**
- Consumes: Task 3'ten `muteRegionForToday`
- Produces: `geofence-reminder` bildirim kategorisi, `mute-today` eylemi; geofence bildirimleri `data.regionId` taşımaya başlar (Task 6'da yazılır)

- [ ] **Step 1: Kategoriyi kaydet**

`src/lib/notifications.ts:158` — `approval-request` kategorisinden sonra ekle:

```ts
  // Geofence hatırlatmaları: yaklaşınca çıkan bildirimi o gün için susturur.
  await notifications.setNotificationCategoryAsync("geofence-reminder", [
    { identifier: "mute-today", buttonTitle: "Bugün sorma" }
  ]);
```

- [ ] **Step 2: İşleyiciye dalı ekle**

`src/lib/notifications.ts` — import bloğuna ekle:

```ts
import { muteRegionForToday } from "@/lib/geofence-throttle";
```

`NotificationPayload` tipini (satır 402) genişlet:

```ts
type NotificationPayload = {
  token?: string;
  url?: string;
  taskId?: string;
  requesterId?: string;
  regionId?: string;
};
```

`handleNotificationActionResponse` içinde, `complete`/`snooze-1h` dalından **önce** ekle:

```ts
  // Geofence hatırlatmasını o gün için sustur — sunucu tokenı gerekmez, tamamen yerel.
  if (actionIdentifier === "mute-today") {
    if (payload.regionId) {
      await muteRegionForToday(payload.regionId);
    }
    return;
  }
```

- [ ] **Step 3: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 4: Döngüsel import olmadığını doğrula**

`geofence-throttle.ts` yalnızca `@react-native-async-storage/async-storage` ve
`@/lib/geofence-throttle-state` import eder; `notifications.ts`'i import etmez.

Çalıştır: `grep -n "^import" "ArX Task mobile/src/lib/geofence-throttle.ts"`
Beklenen: yalnızca AsyncStorage ve geofence-throttle-state satırları

- [ ] **Step 5: Commit**

```bash
git add "ArX Task mobile/src/lib/notifications.ts"
git commit -m "feat(mobile): bildirimlere Bugun sorma eylemi"
```

---

## Task 6: Yol üzeri fırsat bölgesi ve bildirimi

**Files:**
- Modify: `src/lib/geofencing.ts:103-115` (`sendLocalNotification`), `:122-177` (TaskManager işleyicisi), `:311-419` (`syncGeofences`)

**Interfaces:**
- Consumes: Task 3'ten `shouldNotify` / `markNotified`, Task 4'ten `loadTaskOpportunities`, `TASK_OPPORTUNITY_PREFIX`
- Produces: `opp:<companyId>` bölgeleri ve "Yol üzerinde işin var" bildirimi; tüm geofence bildirimleri `data.regionId` + `categoryIdentifier: "geofence-reminder"` taşır

- [ ] **Step 1: `sendLocalNotification`'a kategori ekle**

`src/lib/geofencing.ts:107-114` içindeki `scheduleNotificationAsync` çağrısını değiştir:

```ts
  await notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default", data, categoryIdentifier: "geofence-reminder" },
    // Immediate on iOS; a ~half-second date trigger on Android so it lands on the heads-up channel.
    trigger:
      Platform.OS === "android"
        ? { type: "date", date: new Date(Date.now() + 500), channelId: "task-reminders" }
        : null
  });
```

- [ ] **Step 2: İşleyiciye throttle kapısı ve yeni türü ekle**

`src/lib/geofencing.ts` import bloğuna ekle:

```ts
import { markNotified, shouldNotify } from "@/lib/geofence-throttle";
```

`TaskManager.defineTask` gövdesinde (satır 139-173), `entry` alındıktan sonraki bloğu tamamen
şununla değiştir:

```ts
    const raw = await AsyncStorage.getItem(GEOFENCE_MAP_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, GeofenceMapEntry>) : {};
    const entry = map[region.identifier];
    if (!entry) return;

    // Tekrar kontrolü: aynı yer için tür başına bekleme süresi dolmadan
    // veya "Bugün sorma" denmişken bildirim çıkmaz.
    if (!(await shouldNotify(region.identifier, entry.kind))) return;

    if (entry.kind === "seller") {
      await sendLocalNotification(
        "🛒 Alışveriş hatırlatması",
        `${entry.companyName} yakınında: ${entry.itemName} alınacak`,
        { url: "/shopping", geofence: true, seller: region.identifier, regionId: region.identifier }
      );
      await markNotified(region.identifier);
      return;
    }

    if (entry.kind === "errand") {
      // "Yol üzeri alışveriş fırsatı" — approaching a shop on the active route.
      await sendLocalNotification(
        "Yol üzeri alışveriş",
        `🛒 ${entry.shopName} yakında: ${entry.itemName} al`,
        { url: "/shopping", geofence: true, errand: region.identifier, regionId: region.identifier }
      );
      await markNotified(region.identifier);
      return;
    }

    if (entry.kind === "task-opportunity") {
      // Bugüne tarihli olmayan ama güzergâhın üzerinde kalan açık iş.
      const body =
        entry.taskCount > 1
          ? `${entry.companyName} yakınında — ${entry.taskCount} açık işin var`
          : `${entry.companyName} yakınında — "${entry.taskTitle}"`;
      await sendLocalNotification("Yol üzerinde işin var", body, {
        taskId: entry.taskId,
        companyId: region.identifier.slice(TASK_OPPORTUNITY_PREFIX.length),
        url: "/today",
        geofence: true,
        regionId: region.identifier
      });
      await markNotified(region.identifier);
      return;
    }

    const body_ =
      entry.taskCount > 1
        ? `${entry.companyName} yakınındasınız — bugün ${entry.taskCount} göreviniz var. Yapmak ister misiniz?`
        : `${entry.companyName} yakınındasınız — "${entry.taskTitle}" göreviniz vardı. Yapmak ister misiniz?`;

    await sendLocalNotification("Yakında göreviniz var", body_, {
      taskId: entry.taskId,
      companyId: region.identifier,
      url: "/today",
      geofence: true,
      regionId: region.identifier
    });
    await markNotified(region.identifier);
```

- [ ] **Step 3: `syncGeofences`'a fırsat bölgelerini ekle**

`src/lib/geofencing.ts` — "2. Today's task companies" bloğu ile "3. Route errands" bloğu
**arasına** ekle (satır 363 civarı, `for (const reminder of byCompany.values())` döngüsünden sonra):

```ts
    // 2.5 Yol üzeri görev fırsatları — bugünün görev firmalarından sonra, alışverişten
    // önce. Kullanıcının çerçevesi "o iş için bir daha dışarı çıkmayayım"; alışveriş ikincil.
    const opportunities = await loadTaskOpportunities(todayKeyLocal());
    for (const opportunity of opportunities) {
      if (regions.length >= MAX_REGIONS) break;
      if (!hasCoords(opportunity.latitude, opportunity.longitude)) continue;
      const identifier = `${TASK_OPPORTUNITY_PREFIX}${opportunity.companyId}`;
      if (map[identifier]) continue;
      regions.push({
        identifier,
        latitude: opportunity.latitude,
        longitude: opportunity.longitude,
        radius: GEOFENCE_RADIUS_METERS,
        notifyOnEnter: true,
        notifyOnExit: false
      });
      map[identifier] = {
        kind: "task-opportunity",
        companyName: opportunity.companyName,
        taskTitle: opportunity.taskTitle,
        taskId: opportunity.taskId,
        taskCount: opportunity.taskCount
      };
    }
```

`syncGeofences` üstündeki yorum bloğunu (satır 307-310) güncelle:

```ts
// Rebuilds the full geofence set (home + today's task companies + on-the-way task
// opportunities + route errands + shopping sellers) within the 20-region OS budget.
// Priority: home → company reminders → task opportunities → route errands → sellers.
// Persists a lookup map the headless task reads to compose the notifications.
```

- [ ] **Step 4: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 5: Commit**

```bash
git add "ArX Task mobile/src/lib/geofencing.ts"
git commit -m "feat(mobile): yol uzeri gorev firsati geofence bolgesi ve bildirimi"
```

---

## Task 7: Evden çıkış akışı

**Files:**
- Modify: `src/lib/geofencing.ts:179-233` (`handleHomeExit`)

**Interfaces:**
- Consumes: Task 2'den `findTaskOpportunities`, `buildDepartureSummary`, `ON_THE_WAY_BUFFER_METERS`, `MAX_TASK_OPPORTUNITY_REGIONS`; Task 4'ten `persistTaskOpportunities`, `resyncGeofences`; mevcut `routeErrandStops`, `persistErrandGeofences`
- Produces: evden çıkışta fırsat hesabı + tek özet bildirim

- [ ] **Step 1: Import'ları genişlet**

`src/lib/geofencing.ts`:

```ts
import { createRoute, routeErrandStops } from "@/lib/api";
import {
  buildDepartureSummary,
  findTaskOpportunities,
  MAX_OPEN_TASK_SNAPSHOT,
  MAX_TASK_OPPORTUNITY_REGIONS,
  ON_THE_WAY_BUFFER_METERS,
  taskSortKey,
  type Corridor,
  type TaskOpportunity
} from "@/lib/route-opportunities";
```

- [ ] **Step 2: `handleHomeExit`'i yeniden yaz**

`src/lib/geofencing.ts:179-233` arasındaki fonksiyonu tamamen şununla değiştir:

```ts
// R15 — home-exit auto route. Runs headlessly at most once per day: rebuilds today's
// route plan from the inputs persisted during sync, saves it server-side with source
// "auto-home-exit", hesaplar yol üzeri fırsatları (görevler yerel, alışveriş sunucudan)
// ve tek bir özet bildirimle haber verir.
async function handleHomeExit() {
  const today = todayKeyLocal();
  const lastRun = await AsyncStorage.getItem(AUTO_ROUTE_DATE_KEY).catch(() => null);
  if (lastRun === today) return;
  await AsyncStorage.setItem(AUTO_ROUTE_DATE_KEY, today).catch(() => undefined);

  try {
    const raw = await AsyncStorage.getItem(AUTO_ROUTE_INPUTS_KEY);
    const inputs = raw ? (JSON.parse(raw) as AutoRouteInputs) : null;
    const openTasks = inputs?.tasks ?? [];
    const companies = inputs?.companies ?? [];

    let origin: UserLocationCoordinates | null = null;
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      origin = { latitude: current.coords.latitude, longitude: current.coords.longitude };
    } catch {
      const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
      if (lastKnown?.coords) {
        origin = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
      }
    }

    const todayTasks = openTasks.filter((task) => task.dueDate === today && task.status !== "done");
    const plan = buildTodayRoutePlan(
      todayTasks as unknown as Task[],
      companies as unknown as Company[],
      origin
    );

    const token = await getToken().catch(() => null);
    if (plan.stops.length && token) {
      const payload = buildRoutePayloadFromPlan(plan, origin, today, "auto-home-exit");
      await createRoute(token, { ...payload, status: "planned" }).catch(() => undefined);
    }

    // Koridor: rota varsa [konum, ...duraklar], yoksa [konum].
    const corridor: Corridor = [];
    if (origin) corridor.push(origin);
    for (const stop of plan.stops) {
      if (hasCoords(stop.company.latitude, stop.company.longitude)) {
        corridor.push({ latitude: stop.company.latitude, longitude: stop.company.longitude });
      }
    }

    // Bugünün görev firmaları ve rota durakları hariç: onların kendi bildirimi var.
    const excludeCompanyIds = [
      ...plan.stops.map((stop) => stop.company.id),
      ...todayTasks.map((task) => task.companyId).filter((id): id is string => Boolean(id))
    ];

    const opportunities: TaskOpportunity[] = corridor.length
      ? findTaskOpportunities({
          tasks: openTasks,
          companies,
          corridor,
          bufferMeters: corridor.length > 1 ? ON_THE_WAY_BUFFER_METERS : null,
          excludeCompanyIds,
          limit: MAX_TASK_OPPORTUNITY_REGIONS
        })
      : [];

    await persistTaskOpportunities({ date: today, source: "route", items: opportunities });

    // Alışveriş fırsatları — best-effort, ağ yoksa özet yalnızca görev kısmıyla gider.
    let errandCount = 0;
    if (token && corridor.length) {
      try {
        const response = await withTimeout(
          routeErrandStops(token, { coords: corridor.map((point) => [point.latitude, point.longitude]) }),
          8000
        );
        const matches = response?.matches ?? [];
        errandCount = matches.length;
        await persistErrandGeofences(
          matches.map((match) => ({
            itemId: match.itemId,
            itemName: match.itemName,
            companyId: `${ERRAND_PREFIX}${match.itemId}:${match.latitude},${match.longitude}`,
            companyName: match.shopName,
            latitude: match.latitude,
            longitude: match.longitude
          }))
        );
      } catch {
        // Ağ/zaman aşımı — alışveriş kısmı atlanır.
      }
    }

    await resyncGeofences();

    const summary = buildDepartureSummary({
      stopCount: plan.stops.length,
      taskOpportunityCount: opportunities.length,
      errandCount
    });
    await sendLocalNotification(summary.title, summary.body, {
      url: plan.stops.length ? "/route-planner" : "/today",
      autoRoute: true
    });
  } catch {
    await sendLocalNotification("Günaydın!", "Bugün planlı göreviniz yok.", { url: "/today" }).catch(
      () => undefined
    );
  }
}

// Headless görevin OS tarafından öldürülmemesi için ağ çağrılarına üst sınır.
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), milliseconds))
  ]);
}
```

- [ ] **Step 3: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 4: Cihazda doğrula**

Android'de geliştirme derlemesiyle (Expo Go **değil**):
1. Ayarlar > ev konumunu kaydet.
2. `arx:auto-route-date` kaydını temizlemek için uygulama verisini sıfırla veya cihaz tarihini ilerlet.
3. Sahte konumla ev bölgesinin 150 m dışına çık.
4. Beklenen: tek bildirim; bugünkü rota varsa "Günaydın! Bugünkü rotanız hazır", gövdede fırsat sayıları.

- [ ] **Step 5: Commit**

```bash
git add "ArX Task mobile/src/lib/geofencing.ts"
git commit -m "feat(mobile): evden cikista yol uzeri firsat hesabi ve ozet bildirim"
```

---

## Task 8: Veri senkronunda en-yakın-N modu

**Files:**
- Modify: `src/lib/app-data-context.tsx:284-344` (`rebuildGeofences`)

**Interfaces:**
- Consumes: Task 2'den `findTaskOpportunities`, `MAX_TASK_OPPORTUNITY_REGIONS`; Task 4'ten `loadStoredTaskOpportunities`, `persistTaskOpportunities`
- Produces: rota yokken konuma en yakın açık iş firmalarının izlenmesi

- [ ] **Step 1: Import'ları ekle**

`src/lib/app-data-context.tsx` — mevcut geofencing importunu genişlet:

```ts
import {
  loadStoredTaskOpportunities,
  persistAutoRouteInputs,
  persistErrandGeofences,
  persistTaskOpportunities,
  syncGeofences,
  type ErrandGeofenceInput
} from "@/lib/geofencing";
import { findTaskOpportunities, MAX_TASK_OPPORTUNITY_REGIONS } from "@/lib/route-opportunities";
```

- [ ] **Step 2: `rebuildGeofences` içine en-yakın-N modunu ekle**

`src/lib/app-data-context.tsx` — `persistAutoRouteInputs` çağrısından (satır 317) sonra,
`sellers` hesabından **önce** ekle:

```ts
    // Rota kaynaklı fırsat listesi bugüne aitse dokunma — o sabah kurulan liste
    // gün içindeki veri senkronuyla ezilmemeli. Aksi hâlde rota yokken konuma
    // en yakın açık iş firmalarını izlemeye al (üst mesafe sınırı yok).
    const storedOpportunities = await loadStoredTaskOpportunities().catch(() => null);
    const hasRouteOpportunities = storedOpportunities?.date === todayKey && storedOpportunities.source === "route";
    if (!hasRouteOpportunities) {
      const origin = locationRef.current;
      const nearby = origin
        ? findTaskOpportunities({
            tasks: data.tasks.filter((task) => task.status !== "done" && Boolean(task.companyId)),
            companies: data.companies,
            corridor: [origin],
            bufferMeters: null,
            excludeCompanyIds: Array.from(groups.keys()),
            limit: MAX_TASK_OPPORTUNITY_REGIONS
          })
        : [];
      await persistTaskOpportunities({ date: todayKey, source: "nearby", items: nearby }).catch(
        () => undefined
      );
    }
```

- [ ] **Step 3: Konum referansını sağla**

`AppDataProvider`, `_layout.tsx:83-87` içinde `LocationProvider`'ın **içinde** monte edildiği için
`useUserLocation()` doğrudan kullanılabilir. Konum her değiştiğinde `rebuildGeofences`
useCallback'inin kimliğini bozmamak için değeri bir ref'te tutuyoruz.

Import ekle:

```ts
import { useUserLocation } from "@/lib/location-context";
```

`AppDataProvider` gövdesine, mevcut `useCallback` tanımlarından **önce** ekle:

```ts
  const { state: userLocationState } = useUserLocation();
  // Ref: konum değişimi rebuildGeofences'ı yeniden tetiklemesin, ama en güncel
  // değeri okuyabilelim.
  const locationRef = useRef(userLocationState.coords);
  useEffect(() => {
    locationRef.current = userLocationState.coords;
  }, [userLocationState.coords]);
```

`useRef` React importuna eklenmiş olmalı (`useEffect` zaten mevcut).

- [ ] **Step 4: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 5: Commit**

```bash
git add "ArX Task mobile/src/lib/app-data-context.tsx"
git commit -m "feat(mobile): rota yokken en yakin acik is firmalarini izle"
```

---

## Task 9: Manuel rota başlatmada fırsat akışı

**Files:**
- Modify: `app/(app)/route-planner.tsx:75-159`
- Modify: `src/lib/app-data-context.tsx` (`fetchRouteErrands` çevresi)

**Interfaces:**
- Consumes: Task 2'den `findTaskOpportunities`, `ON_THE_WAY_BUFFER_METERS`, `MAX_TASK_OPPORTUNITY_REGIONS`; Task 4'ten `persistTaskOpportunities`; mevcut `registerErrandGeofences`
- Produces:
  - `type RouteOpportunity = { id: string; kind: "task" | "errand"; title: string; subtitle: string; latitude: number; longitude: number; distanceMeters: number; companyId?: string; taskId?: string }`
  - `route-planner.tsx` içinde `opportunities` state'i

- [ ] **Step 1: Birleşik fırsat tipini tanımla**

`src/types/business.ts` sonuna ekle:

```ts
// Rota planı ekranında görev ve alışveriş fırsatlarını tek listede göstermek için
// kullanılan görünüm modeli.
export interface RouteOpportunity {
  id: string;
  kind: "task" | "errand";
  title: string;      // yer adı (firma / dükkan)
  subtitle: string;   // iş başlığı veya alınacak madde
  latitude: number;
  longitude: number;
  distanceMeters: number;
  companyId?: string;
  taskId?: string;
}
```

- [ ] **Step 2: Yerel görev fırsatlarını ekranda hesapla**

`app/(app)/route-planner.tsx` — import'lara ekle:

```ts
import {
  findTaskOpportunities,
  MAX_TASK_OPPORTUNITY_REGIONS,
  ON_THE_WAY_BUFFER_METERS
} from "@/lib/route-opportunities";
import { persistTaskOpportunities } from "@/lib/geofencing";
import { todayKeyLocal } from "@/lib/geofence-throttle-state";
import type { RouteOpportunity } from "@/types/business";
```

`todayRoutePlan` tanımından sonra ekle:

```ts
  // Koridor: konum + bugünün durakları. Konum yoksa yalnızca duraklardan kurulur.
  const corridor = useMemo(() => {
    const points: Array<{ latitude: number; longitude: number }> = [];
    if (locationState.coords) points.push(locationState.coords);
    for (const stop of todayRoutePlan.stops) {
      if (hasUsableCoordinates(stop.company)) {
        points.push({ latitude: stop.company.latitude, longitude: stop.company.longitude });
      }
    }
    return points;
  }, [locationState.coords, todayRoutePlan.stops]);

  // Görev fırsatları tamamen yerel — ağ beklemeden anında hazır.
  const taskOpportunities = useMemo(() => {
    if (!corridor.length) return [];
    return findTaskOpportunities({
      tasks: data.tasks.filter((task) => task.status !== "done" && Boolean(task.companyId)),
      companies: data.companies,
      corridor,
      bufferMeters: corridor.length > 1 ? ON_THE_WAY_BUFFER_METERS : null,
      excludeCompanyIds: [
        ...todayRoutePlan.stops.map((stop) => stop.company.id),
        ...todayRouteSourceTasks.map((task) => task.companyId).filter((id): id is string => Boolean(id))
      ],
      limit: MAX_TASK_OPPORTUNITY_REGIONS
    });
  }, [corridor, data.companies, data.tasks, todayRoutePlan.stops, todayRouteSourceTasks]);
```

- [ ] **Step 3: İki kaynağı tek listede birleştir**

`errandMatches` state'ini koru, üzerine türetilmiş liste ekle:

```ts
  const opportunities = useMemo<RouteOpportunity[]>(() => {
    const taskRows: RouteOpportunity[] = taskOpportunities.map((item) => ({
      id: `task:${item.companyId}`,
      kind: "task",
      title: item.companyName,
      subtitle: item.taskCount > 1 ? `${item.taskCount} açık iş` : item.taskTitle,
      latitude: item.latitude,
      longitude: item.longitude,
      distanceMeters: item.distanceToRouteMeters,
      companyId: item.companyId,
      taskId: item.taskId
    }));
    const errandRows: RouteOpportunity[] = errandMatches.map((match) => ({
      id: `errand:${match.itemId}:${match.latitude},${match.longitude}`,
      kind: "errand",
      title: match.shopName,
      subtitle: match.itemName,
      latitude: match.latitude,
      longitude: match.longitude,
      distanceMeters: match.distanceToRouteMeters
    }));
    return [...taskRows, ...errandRows];
  }, [errandMatches, taskOpportunities]);
```

- [ ] **Step 4: Rota başlatmada fırsatları diske yaz**

`loadErrandOpportunities` fonksiyonunu şununla değiştir:

```ts
  // Rota başlatıldığında: görev fırsatları (yerel, anında) diske yazılır ve
  // geofence olarak kurulur; alışveriş dükkanları ağdan gelir ve Google Maps'i
  // hiçbir koşulda geciktirmez.
  async function loadRouteOpportunities(origin: UserLocationCoordinates | null) {
    try {
      // Depoyu okuyan taraf (geofencing.ts) YEREL gün anahtarı kullanıyor; buradaki
      // ekran içi `todayKey` ise UTC tabanlı. Aynı saf yardımcıyı kullanarak gece
      // yarısından sonra fırsatların sessizce düşmesini engelliyoruz.
      const localTodayKey = todayKeyLocal(new Date());
      await persistTaskOpportunities({ date: localTodayKey, source: "route", items: taskOpportunities });

      const coords: Array<[number, number]> = [];
      if (origin) coords.push([origin.latitude, origin.longitude]);
      for (const stop of todayRoutePlan.stops) {
        const company = stop.company;
        if (hasUsableCoordinates(company)) coords.push([company.latitude, company.longitude]);
      }
      if (!coords.length) return;

      const matches = await fetchRouteErrands(coords);
      const errands: ErrandGeofenceInput[] = matches.map((match) => ({
        itemId: match.itemId,
        itemName: match.itemName,
        companyId: `errand:${match.itemId}:${match.latitude},${match.longitude}`,
        companyName: match.shopName,
        latitude: match.latitude,
        longitude: match.longitude
      }));
      await registerErrandGeofences(errands);

      if (matches.length) {
        setErrandMatches(matches);
        setErrandModalVisible(true);
      }
    } catch {
      // Best-effort — fırsat kontrolü rota başlatmayı asla bozmamalı.
    }
  }
```

`handleStartTodayRoute` içindeki çağrıyı güncelle (satır 146):

```ts
      void loadRouteOpportunities(nextCoords ?? null);
```

- [ ] **Step 5: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 6: Commit**

```bash
git add "ArX Task mobile/app/(app)/route-planner.tsx" "ArX Task mobile/src/types/business.ts"
git commit -m "feat(mobile): manuel rota baslatmada gorev firsatlarini da hesapla"
```

---

## Task 10: "Yol üzerinde" kartı ve genelleşen modal

**Files:**
- Modify: `app/(app)/route-planner.tsx` (render)
- Modify: `src/lib/i18n.tsx`

**Interfaces:**
- Consumes: Task 9'dan `opportunities: RouteOpportunity[]`
- Produces: ekranda kalıcı "Yol üzerinde" kartı; mevcut modal `SheetModal` ile değiştirilir

- [ ] **Step 1: i18n anahtarlarını ekle**

`src/lib/i18n.tsx` — mevcut `"route.errands.*"` anahtarlarının yanına, **altı dilin her birine** ekle.

`en`:
```ts
    "route.onTheWay.title": "On the way",
    "route.onTheWay.subtitle": "Open work and errands along today's route",
    "route.onTheWay.tasks": "Work",
    "route.onTheWay.errands": "Shopping",
    "route.onTheWay.empty": "Nothing extra along the route",
    "route.onTheWay.offRoute": "off route",
    "route.onTheWay.directions": "Directions",
    "route.onTheWay.addToRoute": "Add to route",
    "route.onTheWay.muteToday": "Mute for today",
    "route.onTheWay.routeFull": "Route is full — Google Maps allows 10 stops at most.",
```

`de`:
```ts
    "route.onTheWay.title": "Unterwegs",
    "route.onTheWay.subtitle": "Offene Arbeiten und Einkäufe entlang der heutigen Route",
    "route.onTheWay.tasks": "Arbeiten",
    "route.onTheWay.errands": "Einkauf",
    "route.onTheWay.empty": "Nichts Zusätzliches entlang der Route",
    "route.onTheWay.offRoute": "abseits der Route",
    "route.onTheWay.directions": "Route",
    "route.onTheWay.addToRoute": "Zur Route hinzufügen",
    "route.onTheWay.muteToday": "Heute nicht mehr",
    "route.onTheWay.routeFull": "Route ist voll — Google Maps erlaubt höchstens 10 Stopps.",
```

`tr`:
```ts
    "route.onTheWay.title": "Yol üzerinde",
    "route.onTheWay.subtitle": "Bugünkü rotanın üzerindeki açık işler ve alışverişler",
    "route.onTheWay.tasks": "İşler",
    "route.onTheWay.errands": "Alışveriş",
    "route.onTheWay.empty": "Yol üzerinde ek iş yok",
    "route.onTheWay.offRoute": "rotadan sapma",
    "route.onTheWay.directions": "Yol tarifi",
    "route.onTheWay.addToRoute": "Rotaya ekle",
    "route.onTheWay.muteToday": "Bugün sorma",
    "route.onTheWay.routeFull": "Rota dolu — Google Maps en fazla 10 durak alıyor.",
```

`ar`:
```ts
    "route.onTheWay.title": "على الطريق",
    "route.onTheWay.subtitle": "المهام المفتوحة والمشاوير على طريق اليوم",
    "route.onTheWay.tasks": "المهام",
    "route.onTheWay.errands": "التسوق",
    "route.onTheWay.empty": "لا يوجد شيء إضافي على الطريق",
    "route.onTheWay.offRoute": "خارج الطريق",
    "route.onTheWay.directions": "الاتجاهات",
    "route.onTheWay.addToRoute": "أضف إلى المسار",
    "route.onTheWay.muteToday": "لا تسأل اليوم",
    "route.onTheWay.routeFull": "المسار ممتلئ — خرائط جوجل تسمح بـ 10 محطات كحد أقصى.",
```

`fr`:
```ts
    "route.onTheWay.title": "Sur le trajet",
    "route.onTheWay.subtitle": "Travaux ouverts et courses sur le trajet du jour",
    "route.onTheWay.tasks": "Travaux",
    "route.onTheWay.errands": "Courses",
    "route.onTheWay.empty": "Rien de plus sur le trajet",
    "route.onTheWay.offRoute": "hors trajet",
    "route.onTheWay.directions": "Itinéraire",
    "route.onTheWay.addToRoute": "Ajouter au trajet",
    "route.onTheWay.muteToday": "Ne plus demander aujourd'hui",
    "route.onTheWay.routeFull": "Trajet complet — Google Maps accepte 10 arrêts au maximum.",
```

`nl`:
```ts
    "route.onTheWay.title": "Onderweg",
    "route.onTheWay.subtitle": "Openstaand werk en boodschappen op de route van vandaag",
    "route.onTheWay.tasks": "Werk",
    "route.onTheWay.errands": "Boodschappen",
    "route.onTheWay.empty": "Niets extra's op de route",
    "route.onTheWay.offRoute": "van de route",
    "route.onTheWay.directions": "Route",
    "route.onTheWay.addToRoute": "Aan route toevoegen",
    "route.onTheWay.muteToday": "Vandaag niet meer",
    "route.onTheWay.routeFull": "Route is vol — Google Maps staat maximaal 10 stops toe.",
```

- [ ] **Step 2: Kartı ekle**

`app/(app)/route-planner.tsx` — hero kartından (satır 191-203) **sonra** ekle:

```tsx
      <Card>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t("route.onTheWay.title")}</Text>
          <Chip
            label={`${opportunities.length}`}
            tone={opportunities.length ? "success" : "default"}
          />
        </View>
        <Text style={styles.sectionHint}>{t("route.onTheWay.subtitle")}</Text>
        {opportunities.length === 0 ? (
          <EmptyState title={t("route.onTheWay.empty")} description={t("route.onTheWay.subtitle")} />
        ) : (
          opportunities.map((item) => (
            <Pressable key={item.id} onPress={() => setSelectedOpportunityId(item.id)} style={styles.errandRow}>
              <View style={styles.errandIcon}>
                <Feather
                  name={item.kind === "task" ? "briefcase" : "shopping-bag"}
                  size={16}
                  color={colors.primaryDark}
                />
              </View>
              <View style={styles.errandCopy}>
                <Text style={styles.errandTitle}>
                  {item.title} — {item.subtitle}
                </Text>
                <Text style={styles.errandMeta}>
                  {t(item.kind === "task" ? "route.onTheWay.tasks" : "route.onTheWay.errands")} ·{" "}
                  {formatDistanceLabel(item.distanceMeters) ?? "?"} {t("route.onTheWay.offRoute")}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.subtle} />
            </Pressable>
          ))
        )}
      </Card>
```

`Chip` yalnızca `"default" | "success" | "warning" | "danger"` tonlarını kabul eder
(`src/components/ui.tsx:184`) — yukarıdaki kullanım buna uygundur.

- [ ] **Step 3: Modal'ı SheetModal'a çevir**

`errandModalVisible` state'ini kaldır, yerine seçili fırsat state'i koy:

```ts
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const selectedOpportunity = opportunities.find((item) => item.id === selectedOpportunityId) ?? null;
```

Mevcut `<Modal>` bloğunu (satır 337-367) şununla değiştir:

```tsx
      <SheetModal
        visible={Boolean(selectedOpportunity)}
        title={selectedOpportunity?.title ?? ""}
        subtitle={selectedOpportunity?.subtitle}
        onClose={() => setSelectedOpportunityId(null)}
      >
        <Text style={styles.errandMeta}>
          {formatDistanceLabel(selectedOpportunity?.distanceMeters) ?? "?"} {t("route.onTheWay.offRoute")}
        </Text>
      </SheetModal>
```

Import ekle: `import { SheetModal } from "@/components/sheet-modal";`

`setErrandModalVisible` çağrısını `loadRouteOpportunities` içinden kaldır (fırsatlar artık
kartta kalıcı görünüyor; modal yalnızca satıra dokununca açılıyor).

`Modal` artık kullanılmadığı için 2. satırdaki `react-native` importundan çıkar:

```ts
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
```

- [ ] **Step 4: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 5: Görsel doğrulama**

Çalıştır: `npm run android` (veya mevcut geliştirme derlemesi)
Doğrula: Rota planı ekranında "Yol üzerinde" kartı görünüyor, satıra dokununca alt sayfa açılıyor.

- [ ] **Step 6: Commit**

```bash
git add "ArX Task mobile/app/(app)/route-planner.tsx" "ArX Task mobile/src/lib/i18n.tsx"
git commit -m "feat(mobile): Yol uzerinde karti ve firsat detay sayfasi"
```

---

## Task 11: Uygulama içi OSM haritası

**Files:**
- Modify: `package.json`
- Create: `src/components/route-map.tsx`
- Modify: `app/(app)/route-planner.tsx`

**Interfaces:**
- Consumes: Task 9'dan `RouteOpportunity`, `corridor`, `todayRoutePlan.stops`
- Produces: `<RouteMap stops opportunities origin onSelectOpportunity />`

- [ ] **Step 1: WebView bağımlılığını kur**

Çalıştır: `npx expo install react-native-webview`

Bu, SDK 54 ile uyumlu sürümü `dependencies`'e ekler. **Yeni native modül** — sonraki APK
`assembleRelease` ile ve **aynı keystore** ile derlenmeli
(`ArX Task mobile/credentials/planix-release.keystore`).

- [ ] **Step 2: Harita bileşenini yaz**

`src/components/route-map.tsx`:

```tsx
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
```

- [ ] **Step 3: Haritayı ekrana bağla**

`app/(app)/route-planner.tsx` — "Yol üzerinde" kartının içine, `sectionHint` metninden **sonra**
ve fırsat listesinden **önce** ekle:

```tsx
        <RouteMap
          origin={locationState.coords ?? null}
          stops={todayRoutePlan.stops.map((stop) => ({
            name: stop.company.name,
            latitude: stop.company.latitude,
            longitude: stop.company.longitude
          }))}
          opportunities={opportunities}
          onSelectOpportunity={(id) => setSelectedOpportunityId(id)}
        />
```

Import ekle: `import { RouteMap } from "@/components/route-map";`

- [ ] **Step 4: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 5: Cihazda doğrula**

Çalıştır: `npx expo run:android`
Doğrula:
1. Rota planı ekranında harita yükleniyor, duraklar numaralı kırmızı pin.
2. Fırsatlar yeşil (iş) / sarı (alışveriş) pin olarak görünüyor.
3. Fırsat pinine dokununca alt sayfa açılıyor.
4. Uçak modunda harita boş kalıyor ama ekranın geri kalanı çalışıyor.

- [ ] **Step 6: Commit**

```bash
git add "ArX Task mobile/package.json" "ArX Task mobile/package-lock.json" "ArX Task mobile/src/components/route-map.tsx" "ArX Task mobile/app/(app)/route-planner.tsx"
git commit -m "feat(mobile): rota plani ekranina uygulama ici OSM haritasi"
```

---

## Task 12: Pin eylemleri — yol tarifi, rotaya ekle, bugün sorma

**Files:**
- Modify: `app/(app)/route-planner.tsx`

**Interfaces:**
- Consumes: Task 3'ten `muteRegionForToday`; Task 10'dan `selectedOpportunity` ve i18n anahtarları; mevcut `openMultiCompanyRoute`, `buildRoutePayloadFromPlan`
- Produces: alt sayfada üç eylem; `manualExtraStops` ile isteğe bağlı durak ekleme

- [ ] **Step 1: `manualExtraStops` state'ini ekle**

`app/(app)/route-planner.tsx`:

```ts
  // Kullanıcının fırsat listesinden rotaya eklediği ek duraklar. Fırsatlar
  // varsayılan olarak rotaya girmez — bu tamamen isteğe bağlı.
  const [manualExtraStops, setManualExtraStops] = useState<Company[]>([]);
```

Import ekle: `import type { Company } from "@/types/business";` (dosyada zaten `RouteOpportunity`
importu var, aynı satıra eklenebilir.)

- [ ] **Step 2: Rota açılışına ve sunucu kaydına ek durakları dahil et**

Ek duraklar hem Google Maps'e hem sunucudaki rota kaydına girmeli. `handleStartTodayRoute`
gövdesinin **başına** ekle:

```ts
      // Kullanıcının elle eklediği fırsat durakları planın sonuna eklenir.
      // Google Maps URL API'si 9 ara nokta + 1 varış kabul ettiği için MAX_ROUTE_STOPS ile kırpılır.
      const effectivePlan = manualExtraStops.length
        ? {
            ...todayRoutePlan,
            stops: [
              ...todayRoutePlan.stops,
              ...manualExtraStops.map((company) => ({
                company,
                tasks: [],
                distanceMeters: null,
                firstDueSortKey: "9999-12-31T23:59"
              }))
            ].slice(0, MAX_ROUTE_STOPS)
          }
        : todayRoutePlan;
```

Import ekle: `MAX_ROUTE_STOPS` — `@/lib/today-route` importuna eklenir.

`buildRoutePayloadFromPlan` çağrısını değiştir (satır 132):

```ts
            const payload = buildRoutePayloadFromPlan(effectivePlan, nextCoords ?? null, todayKey, "manual");
```

`openMultiCompanyRoute` çağrısını değiştir (satır 148):

```ts
      await openMultiCompanyRoute(
        effectivePlan.stops.map((stop) => stop.company),
        nextCoords ?? null
      );
```

`if (!todayRoutePlan.stops.length) return;` koşulunu koru — ek duraklar tek başına rota
başlatmaz, bugünün rotası boşsa "Rota yok" durumu geçerlidir.

- [ ] **Step 3: Alt sayfaya eylemleri ekle**

Task 10'daki `SheetModal` bloğunu şununla değiştir:

```tsx
      <SheetModal
        visible={Boolean(selectedOpportunity)}
        title={selectedOpportunity?.title ?? ""}
        subtitle={selectedOpportunity?.subtitle}
        onClose={() => setSelectedOpportunityId(null)}
        footer={
          <View style={styles.sheetActions}>
            <PrimaryButton
              label={t("route.onTheWay.directions")}
              onPress={() => {
                if (selectedOpportunity) void openPointRoute(selectedOpportunity);
                setSelectedOpportunityId(null);
              }}
            />
            {selectedOpportunity?.kind === "task" ? (
              <Pressable style={styles.sheetSecondary} onPress={() => handleAddToRoute()}>
                <Text style={styles.sheetSecondaryText}>{t("route.onTheWay.addToRoute")}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.sheetSecondary} onPress={() => void handleMuteToday()}>
              <Text style={styles.sheetSecondaryText}>{t("route.onTheWay.muteToday")}</Text>
            </Pressable>
          </View>
        }
      >
        <Text style={styles.errandMeta}>
          {formatDistanceLabel(selectedOpportunity?.distanceMeters) ?? "?"} {t("route.onTheWay.offRoute")}
        </Text>
      </SheetModal>
```

Stil ekle:

```ts
  sheetActions: {
    gap: 8
  },
  sheetSecondary: {
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border
  },
  sheetSecondaryText: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: "600"
  },
```

- [ ] **Step 4: Eylem işleyicilerini yaz**

```ts
  // Tek noktalık yol tarifi — ana rotaya dokunmaz.
  async function openPointRoute(opportunity: RouteOpportunity) {
    const query = `${opportunity.latitude},${opportunity.longitude}`;
    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() =>
      Alert.alert("Harita açılamadı", "Google Maps açılamadı.")
    );
  }

  // Fırsatı isteğe bağlı olarak rotaya ekler. Google Maps URL API'si en fazla
  // 9 ara nokta + 1 varış kabul ettiği için toplam MAX_ROUTE_STOPS ile sınırlı.
  function handleAddToRoute() {
    if (!selectedOpportunity?.companyId) return;
    const company = companyById(data.companies, selectedOpportunity.companyId);
    if (!company) return;
    const total = todayRoutePlan.stops.length + manualExtraStops.length;
    if (total >= MAX_ROUTE_STOPS) {
      Alert.alert(t("route.onTheWay.title"), t("route.onTheWay.routeFull"));
      return;
    }
    setManualExtraStops((current) =>
      current.some((item) => item.id === company.id) ? current : [...current, company]
    );
    setSelectedOpportunityId(null);
  }

  // Bu yeri bugün için sustur — geofence bildirim kimliğiyle aynı anahtar kullanılır.
  async function handleMuteToday() {
    if (!selectedOpportunity) return;
    const regionId =
      selectedOpportunity.kind === "task"
        ? `opp:${selectedOpportunity.companyId}`
        : selectedOpportunity.id;
    await muteRegionForToday(regionId).catch(() => undefined);
    setSelectedOpportunityId(null);
  }
```

Import ekle: `Linking` — dosyanın 2. satırındaki mevcut `react-native` importuna eklenir
(ayrı bir import satırı açma, aynı modülden iki kez import lint uyarısı verir):

```ts
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
```

```ts
import { muteRegionForToday } from "@/lib/geofence-throttle";
```

- [ ] **Step 5: Tip kontrolü**

Çalıştır: `npm run typecheck`
Beklenen: hata yok

- [ ] **Step 6: Cihazda doğrula**

1. Bir görev fırsatına dokun → "Yol tarifi" Google Maps'i tek pinle açıyor, ana rota bozulmuyor.
2. "Rotaya ekle" → durak listesine ekleniyor, "Rotayı başlat" o durakla açılıyor.
3. "Bugün sorma" → o yerin yanından geçerken bildirim çıkmıyor.

- [ ] **Step 7: Tüm testleri çalıştır**

Çalıştır: `npm run test:logic && npm run typecheck`
Beklenen: 24 test PASS, tip hatası yok

- [ ] **Step 8: Commit**

```bash
git add "ArX Task mobile/app/(app)/route-planner.tsx"
git commit -m "feat(mobile): firsat pin eylemleri - yol tarifi, rotaya ekle, bugun sorma"
```

---

## Spec kapsam kontrolü

| Spec bölümü | Karşılayan görev |
|---|---|
| §4.2 `route-opportunities.ts` | Task 1, 2 |
| §4.3 koridor modları | Task 2 (`bufferMeters: null`), Task 7, 8, 9 |
| §4.4 sabitler | Task 2 |
| §5 kalıcılık (5 anahtar) | Task 3 (`arx:geofence-notified`), Task 4 (diğerleri) |
| §6 tetikleyiciler | Task 7 (çıkış), Task 8 (senkron), Task 9 (manuel) |
| §7 bölge bütçesi | Task 6 |
| §8.1 bildirim türleri | Task 6 |
| §8.2 çıkış özeti | Task 2 (metin), Task 7 (kullanım) |
| §8.3 tekrar kontrolü | Task 3, Task 6 |
| §8.4 "Bugün sorma" | Task 5, Task 12 |
| §9.1 "Yol üzerinde" kartı | Task 10 |
| §9.2 uygulama içi harita | Task 11 |
| §9.3 "Rotaya ekle" | Task 12 |
| §10 hata yönetimi | Task 7 (timeout, catch), Task 11 (harita onError) |
| §11 test | Task 1, 2, 3 |
