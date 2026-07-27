# Yol Üzeri Görev Hatırlatma — Tasarım

Tarih: 2026-07-27
Durum: Onaylandı, uygulamaya hazır

## 1. Problem

Bugün uygulama iki ayrı yerde "yolun üzeri" mantığı çalıştırıyor ve ikisi de dar:

- **Firma yakınlık hatırlatması** yalnızca `dueDate === bugün` olan görevler için kuruluyor
  (`ArX Task mobile/src/lib/app-data-context.tsx:297`). Gelecek haftaya kayıtlı ya da tarihsiz bir
  görevin firması tam güzergâhın üstünde olsa bile hiçbir bildirim çıkmıyor.
- **Yol üzeri alışveriş** (`/route/errand-stops`) yalnızca Rota planı ekranındaki manuel
  "Rotayı başlat" düğmesinden tetikleniyor (`app/(app)/route-planner.tsx:146`). Evden çıkış
  tetikleyicisi (`handleHomeExit`, `src/lib/geofencing.ts:182`) sadece rotayı oluşturup
  "Bugünkü rotanız hazır" bildirimi atıyor.
- Headless çıkış akışına taşınan veri de yalnızca bugünün görevleri
  (`persistAutoRouteInputs`, `src/lib/geofencing.ts:317`), dolayısıyla daha geniş bir
  değerlendirme yapmak teknik olarak da mümkün değil.

Sonuç: kullanıcı dışarıdayken, hâlihazırda yanından geçtiği bir yerdeki açık işi kaçırıyor ve
o iş için ikinci kez yola çıkmak zorunda kalıyor.

## 2. Amaç

Kullanıcı yola çıktığında — ister evden çıkışta otomatik, ister manuel rota başlatmada —
güzergâhının üzerindeki **açık görevlere ait firmalar** ve **açık alışveriş maddelerini satan
dükkanlar** hatırlatılsın; böylece aynı iş için ikinci bir sefer gerekmesin.

## 3. Kapsam kararları

| Konu | Karar |
|---|---|
| Hangi görevler aday | **Tüm açık görevler** — tarih fark etmez (bugünkü, gelecek tarihli, tarihsiz) |
| "Yol üzeri" sayılma mesafesi | Rota koridoruna **1 km** |
| Tetikleyiciler | Evden çıkış (headless) + manuel "Rotayı başlat" + veri değişimi |
| Çıkış bildirimi | **Tek özet bildirim** + her yere yaklaşınca ayrı hatırlatma |
| Rotasız gün | Fırsat takibi yine çalışır: konuma en yakın N açık görev firması izlenir, **üst mesafe sınırı yok** |
| Tekrar kontrolü | Yer başına kısıtlama + bildirimde "Bugün sorma" |
| Bugünün görev bildirimleri | **Ayrı kalır** — mevcut "Yakında göreviniz var" akışı korunur |
| Haritada gösterim | Uygulama içi OSM haritası; fırsatlar pin olarak görünür, **rotaya zorunlu durak olarak eklenmez** |
| API değişikliği | **Yok** — mevcut `/route/errand-stops` aynen kullanılır |

## 4. Mimari

### 4.1 Veri sahipliği ayrımı

| Ne | Nerede hesaplanır | Gerekçe |
|---|---|---|
| Görev firmaları | Cihaz (`route-opportunities.ts`) | Görev ve firma verisi zaten AsyncStorage'da; ağ gerekmez, evden çıkışta garanti çalışır |
| Alışveriş dükkanları | Sunucu (`/route/errand-stops`) | Overpass/OSRM zorunlu, dış veri |

Kritik yol (evden çıkışta görev hatırlatması) hiçbir ağ çağrısına bağlı değil. Alışveriş kısmı
"best-effort" — ağ yoksa özet bildirim sadece görev kısmıyla gider.

### 4.2 Yeni modül: `src/lib/route-opportunities.ts`

Saf mantık. React, React Native, ağ ve AsyncStorage bağımlılığı **yok**; yalnızca `import type`
kullanır (tip importları çalışma zamanında silinir, böylece modül test koşucusunda alias
çözümlemesi olmadan çalışır).

Girdi tipleri `arx:auto-route-inputs` içinde saklanan biçimin aynısıdır (`AutoRouteInputs`,
`geofencing.ts:66`): `TaskSnapshot = Pick<Task, "id" | "title" | "companyId" | "dueDate" | "dueTime" | "status">`,
`CompanySnapshot = Pick<Company, "id" | "name" | "address" | "latitude" | "longitude">`.

```ts
export type Coordinate = { latitude: number; longitude: number };
export type Corridor = Coordinate[];

export type TaskOpportunity = {
  companyId: string;
  companyName: string;
  latitude: number;
  longitude: number;
  taskId: string;        // firmadaki en yakın vadeli görev
  taskTitle: string;
  taskCount: number;     // firmadaki açık görev sayısı
  distanceToRouteMeters: number;
};

// Bir noktanın çoklu-çizgiye (ardışık duraklar) en kısa mesafesi.
// Tek noktalı koridorda düz nokta-nokta mesafesine indirgenir.
export function distanceToCorridorMeters(point: Coordinate, corridor: Corridor): number;

export function findTaskOpportunities(input: {
  tasks: TaskSnapshot[];
  companies: CompanySnapshot[];
  corridor: Corridor;
  bufferMeters: number | null;   // null → mesafe filtresi yok (rotasız gün / en-yakın-N)
  excludeCompanyIds: string[];
  limit: number;
}): TaskOpportunity[];
```

`findTaskOpportunities` sırası:

1. `status === "done"` olan, `companyId` taşımayan görevler elenir.
2. Firması bulunamayan veya kullanılabilir koordinatı olmayan görevler elenir
   (`today-route.ts` içindeki `hasUsableCoordinates` ölçütü).
3. `excludeCompanyIds` içindeki firmalar elenir.
4. Kalanlar firmaya göre gruplanır; `taskId`/`taskTitle` grubun en yakın vadeli görevinden alınır
   (`dueDate` yoksa `9999-12-31`), `taskCount` grup boyutudur.
5. Her firma için `distanceToCorridorMeters` hesaplanır; `bufferMeters` doluysa o mesafeden
   uzaktakiler elenir.
6. Mesafeye göre artan sıralanır, eşitlikte firma adı (`tr` yerel) ile; ilk `limit` tanesi döner.

`distanceToCorridorMeters`, nokta ile her ardışık durak çiftinin oluşturduğu doğru parçası
arasındaki en kısa mesafeyi alır. Segment matematiği düzlemsel yaklaşıklama ile yapılır
(enlem ölçekli ekvatoral izdüşüm), sonuç haversine ölçeğine çevrilir. Şehir içi mesafelerde
hata payı ihmal edilebilir; bugün `today-route.ts:185` içinde yalnızca nokta-nokta haversine var,
segment mesafesi yok.

### 4.3 Koridor modları

- **Rota varsa:** `[mevcut konum, ...bugünün durakları]`, `bufferMeters = 1000`.
- **Rota yoksa:** `[mevcut konum]`, `bufferMeters = null`. Konuma en yakın `limit` firma izlemeye
  alınır. Bildirim yalnızca 1 km'ye girince çıktığı için uzaktaki bir firma gürültü yapmaz,
  sadece izleme kotasında yer tutar. **Üst mesafe sınırı yok** (bilinçli karar).

Her iki modda da `limit = MAX_TASK_OPPORTUNITY_REGIONS` (6) — izlenebilecek bölge sayısından
fazla fırsat hesaplamanın anlamı yok.

### 4.4 Sabitler

```ts
const ON_THE_WAY_BUFFER_METERS = 1000;
const MAX_TASK_OPPORTUNITY_REGIONS = 6;
const MAX_OPEN_TASK_SNAPSHOT = 300;
```

## 5. Kalıcılık (AsyncStorage)

| Anahtar | Durum | İçerik |
|---|---|---|
| `arx:auto-route-inputs` | **genişliyor** | Bugünün görevleri yerine `companyId` taşıyan **tüm açık görevler**, `dueDate` yakından uzağa sıralı, ilk `MAX_OPEN_TASK_SNAPSHOT` tanesi + firmalar |
| `arx:task-opportunities` | **yeni** | `{ date, source: "route" \| "nearby", items: TaskOpportunity[] }` |
| `arx:geofence-sync-input` | **yeni** | `syncGeofences`'ın son girdisi: `{ companies, home, sellers }` |
| `arx:geofence-notified` | **yeni** | `{ date, entries: Record<regionId, { lastNotifiedAt: number; muted: boolean }> }` |
| `arx:errand-geofences` | mevcut | Değişmiyor |
| `arx:auto-route-date` | mevcut | Günde bir kez çıkış kilidi, değişmiyor |

`arx:geofence-sync-input` şunun için gerekli: `syncGeofences` bugün girdisini React ağacından
alıyor (`app-data-context.tsx:339`), headless uyanmada o ağaç yok. `syncGeofences` her çağrıldığında
girdisini diske yazar; yeni `resyncGeofences()` fonksiyonu bu anlık görüntüyü okuyup bölgeleri
React olmadan yeniden kurar. Bu, alışveriş dükkanlarının bugün zaten kullandığı kalıbın aynısı
(`loadErrandGeofences`, `geofencing.ts:296`) — yeni bir desen icat edilmiyor.

## 6. Tetikleyiciler ve akışlar

| Ne zaman | Nerede | Mod | Yazdığı `source` |
|---|---|---|---|
| Evden çıkış (uygulama kapalıyken de) | `handleHomeExit` | rota varsa koridor, yoksa en-yakın-N | `"route"` |
| "Rotayı başlat" | `route-planner.tsx` | koridor | `"route"` |
| Veri değişimi / senkron | `rebuildGeofences` | en-yakın-N | `"nearby"` |

`rebuildGeofences` kuralı: depodaki kayıt bugüne ait **ve** `source === "route"` ise dokunmaz.
Aksi hâlde en-yakın-N hesaplayıp `"nearby"` olarak yazar. Böylece gün içinde gelen bir veri
senkronu, o sabah kurulan rota fırsatlarını ezmez. Tarih değiştiğinde kayıt geçersiz sayılır.

### 6.1 Evden çıkış akışı

1. OS, ev bölgesinden çıkışta uygulamayı headless uyandırır → `handleHomeExit`
   (günde bir kez kilidi zaten mevcut, `geofencing.ts:184`).
2. `arx:auto-route-inputs` okunur; konum alınır (`getCurrentPositionAsync`, başarısızsa
   `getLastKnownPositionAsync` — mevcut kod).
3. `buildTodayRoutePlan` ile bugünün rotası kurulur (mevcut kod).
4. Koridor kurulur (§4.3).
5. `findTaskOpportunities` çalışır. **Hariç tutulanlar:** rotanın kendi durakları ve bugünün
   görev firmaları — ikincisinin zaten kendi "Yakında göreviniz var" geofence'i var, çift
   bildirim olmasın.
6. Sonuç `arx:task-opportunities`'e yazılır.
7. Token ve ağ varsa `routeErrandStops` çağrılır (**8 sn timeout**, hata sessizce yutulur) →
   `persistErrandGeofences`.
8. `resyncGeofences()` → bölgeler yeniden kurulur.
9. Tek özet bildirim atılır (§8.2).

Adım 7 dışındaki her şey ağsız çalışır.

### 6.2 Manuel rota başlatma akışı

`handleStartTodayRoute` içinde mevcut sıra korunur (rota kaydet → başlat → Google Maps aç).
Eklenen: adım 4–6 yerel olarak anında çalışır, adım 7 mevcut `loadErrandOpportunities`
çağrısının yerini alır. Fırsatlar **Google Maps'i geciktirmez**; kullanıcı Maps'e geçtiyse
sonuç özet bildirim olarak gelir.

## 7. Geofence bölge bütçesi

OS aynı anda 20 bölge izleyebiliyor (iOS sınırı, `geofencing.ts:28`). Yeni öncelik sırası:

```
1. Ev bölgesi                        (1, yalnızca çıkış)
2. Bugünün görev firmaları           (sınırsız — en yüksek öncelik)
3. Yol üzeri görev fırsatları        (maks 6)   ← YENİ
4. Yol üzeri alışveriş dükkanları    (maks 8)
5. Alışveriş satıcı firmaları        (kalan)
```

Görev fırsatları alışverişin üstünde: kullanıcının çerçevesi "o iş için bir daha dışarı
çıkmayayım", alışveriş ikincil. Bugünün görevleri her koşulda önce gelir; onlar bütçeyi
doldurursa fırsat bölgesi kurulmaz — kabul edilen davranış.

Yeni bölge kimliği ön eki: `opp:` (`opp:<companyId>`). Yeni harita girdisi:

```ts
| { kind: "task-opportunity"; companyName: string; taskTitle: string; taskId: string; taskCount: number }
```

## 8. Bildirimler

### 8.1 Türler

| Bildirim | Tetikleyici | Durum |
|---|---|---|
| "Yakında göreviniz var" | Bugünün görev firması, 1 km | mevcut, ayrı kalıyor |
| **"Yol üzerinde işin var"** | Yol üzeri görev fırsatı, 1 km | **yeni** |
| "Yol üzeri alışveriş" | Rota koridorundaki dükkan | mevcut |
| "🛒 Alışveriş hatırlatması" | Kayıtlı satıcı firma yakını | mevcut |
| Çıkış özeti | Evden çıkış | genişliyor |

Yeni bildirimin gövdesi:
- Tek görev: `Mergeniye Ltd. yakınında — "Panel ölçüsü al"`
- Çoklu: `Mergeniye Ltd. yakınında — 3 açık işin var`

`data` yükü: `{ taskId, companyId, regionId, url: "/today", geofence: true }`. Dokunulduğunda
`/today?task=<id>` açılır; bu deep-link zaten çalışıyor (`app/_layout.tsx:63`).

### 8.2 Çıkış özeti metinleri

| Durum | Başlık | Gövde |
|---|---|---|
| Rota + fırsat | Günaydın! Bugünkü rotanız hazır | `4 durak · yol üzerinde 3 iş, 2 alışveriş` |
| Rota, fırsat yok | (mevcut metin) | `Bugünkü rotanız hazır — 4 durak` |
| Rota yok, fırsat var | Bugün planlı göreviniz yok | `Yakınınızda 3 açık iş var` |
| Rota yok, fırsat yok | (mevcut metin) | `Bugün planlı göreviniz yok.` |

Fırsat sayıları sıfırsa ilgili kısım cümleden düşer ("yol üzerinde 3 iş" / "2 alışveriş"
bağımsız eklenir).

### 8.3 Tekrar kontrolü

Yeni modül `src/lib/geofence-throttle.ts` — `arx:geofence-notified` deposunu yönetir. Ayrı
dosya olmasının nedeni hem `geofencing.ts`'i (halihazırda ~440 satır) büyütmemek hem de
`notifications.ts → geofencing.ts` importundan kaçınmak.

```ts
type GeofenceKind = "company" | "task-opportunity" | "errand" | "seller";

const DAY = 24 * 60 * 60 * 1000;
const COOLDOWN_BY_KIND: Record<GeofenceKind, number> = {
  company: 4 * 60 * 60 * 1000,   // bugünün görevi — gün içinde ikinci şans
  "task-opportunity": DAY,
  errand: DAY,
  seller: DAY
};

export async function shouldNotify(regionId: string, kind: GeofenceKind): Promise<boolean>;
export async function markNotified(regionId: string): Promise<void>;
export async function muteRegionForToday(regionId: string): Promise<void>;
```

Depo gün değiştiğinde sıfırlanır. `muted` bayrağı bekleme süresinden bağımsız olarak o yeri
gün sonuna kadar susturur.

**Neden tür başına farklı süre:** bugünün görevi bugün bitmeli — sabah geçip yapmadıysan akşam
tekrar geçerken hatırlatma değerli, bu yüzden 4 saat. Yol üzeri fırsatların tarihi bugün değil,
ikinci bildirim yalnızca gürültü, bu yüzden günde bir. Bu aynı zamanda mevcut "her geçişte çal"
davranışının da düzeltilmesidir.

### 8.4 "Bugün sorma" düğmesi

Yeni bildirim kategorisi `geofence-reminder`, tek eylem: `mute-today` → "Bugün sorma".
Dört geofence bildiriminin hepsinde kullanılır. `configureNotificationCategories`
(`notifications.ts:144`) genişletilir; `handleNotificationActionResponse`
(`notifications.ts:409`) `mute-today` dalını alır ve `muteRegionForToday(data.regionId)` çağırır.
Bunun için tüm geofence bildirimlerinin `data` yüküne `regionId` eklenir.

## 9. Ekran değişiklikleri

Tek ekran değişiyor: **Rota planı** (`app/(app)/route-planner.tsx`). Mevcut "Optimum durak
sırası", "Rota adayı saha görevleri" ve "Rotaya eklenmeyen görevler" kartlarına dokunulmaz.

### 9.1 "Yol üzerinde" kartı

Kalıcı yeni kart. Rota başlatılmadan da doludur, çünkü görev fırsatları yerel ve anlık
hesaplanır. İki bölüm: **İşler** (📍) ve **Alışveriş** (🛒). Her satır: yer adı, iş/madde adı,
rotadan sapma mesafesi. Alışveriş bölümü yalnızca sunucu yanıtı geldiyse dolar.

Mevcut `errandMatches` state'i `opportunities: RouteOpportunity[]`'e genelleşir; her öğe
`kind: "task" | "errand"` taşır. Mevcut modal aynı veriyi gösteren bir detay görünümüne dönüşür.

### 9.2 Uygulama içi harita

Yeni bileşen `src/components/route-map.tsx` — `react-native-webview` içinde satır içi HTML,
Leaflet 1.9.4 (unpkg) ve OpenStreetMap döşemeleri.

- Rota çizgisi + numaralı durak pinleri.
- Fırsat pinleri farklı renkte; **rotaya waypoint olarak eklenmez**.
- Pine dokunma WebView'dan RN'e `postMessage` ile gelir; RN bir eylem sayfası açar:
  **Yol tarifi** (o tek nokta için Google Maps) · **Rotaya ekle** · **Bugün sorma**.

**Neden `react-native-maps` değil:** Android'de Google Maps SDK anahtarı ve faturalandırma
hesabı gerektiriyor. WebView + OSM ücretsiz ve anahtarsız; sunucu tarafı zaten OSM/Overpass/OSRM
kullandığı için yığınla tutarlı. Tek yeni bağımlılık `react-native-webview` (Expo destekli).

**Neden Google Maps'te gösterilemiyor:** navigasyon deep-link ile açılıyor
(`src/lib/location.ts:195-205`) ve Google Maps URL API'sinde "rotaya dahil olmayan işaretçi"
diye bir kavram yok — gönderilen her nokta zorunlu `waypoint` olur.

### 9.3 "Rotaya ekle"

Kullanıcı bir fırsatı rotaya eklerse, o firma oturum düzeyindeki `manualExtraStops` listesine
girer ve hem `openMultiCompanyRoute` hem `buildRoutePayloadFromPlan` çağrılarına dahil edilir.
Google Maps URL API'si en fazla 9 ara nokta + 1 varış kabul ettiği ve `MAX_ROUTE_STOPS` 10
olduğu için: toplam 10'u aşacaksa ekleme reddedilir ve kullanıcıya uyarı gösterilir.

## 10. Hata yönetimi ve bozulma

| Durum | Davranış |
|---|---|
| Ağ yok (evden çıkışta) | Görev fırsatları yine gelir; alışveriş kısmı atlanır |
| Konum izni yok | Koridor yalnızca duraklardan kurulur — mevcut bozulma yolu |
| Harita yüklenemedi | Harita kartı gizlenir, liste kalır |
| Expo Go | Geofence zaten devre dışı; liste ve harita çalışır |
| Token yok | Sunucu çağrıları atlanır |
| Anlık görüntü bayat | Fırsat bildirimi başka cihazda kapatılmış bir görev için çıkabilir; dokunulduğunda gerçek durum görünür (kabul edilen risk) |

Headless görev hiçbir koşulda hata fırlatmaz — mevcut `try/catch` kalıbı korunur
(`geofencing.ts:174`).

## 11. Test

Projede test altyapısı yok (`package.json`'da yalnızca `typecheck`). `route-opportunities.ts`
bilinçli olarak saf tutulduğu için ona minimal bir koşucu ekleniyor:

- `tsx` devDependency + `"test:logic": "node --test --import tsx src/lib/*.test.ts"`
- Test dosyası `src/lib/route-opportunities.test.ts`, göreli import kullanır.

Kapsam:

1. `distanceToCorridorMeters` — bilinen koordinatlarla nokta-segment mesafesi; segmentin
   dışına düşen nokta uç noktaya kilitlenir.
2. Tek noktalı koridorda nokta-nokta mesafesine indirgenir.
3. 1 km sınırı: 900 m'deki firma girer, 1.100 m'deki elenir.
4. Aynı firmadaki iki açık görev tek fırsata gruplanır, `taskCount = 2`, `taskTitle` en yakın
   vadeli görevden gelir.
5. `excludeCompanyIds` içindeki firma (rota durağı / bugünün görev firması) çıkmaz.
6. `bufferMeters: null` modunda mesafe filtresi uygulanmaz, sıralama yine mesafeye göredir.
7. `limit` aşılmaz.

Gerisi: `npm run typecheck` (hem kök hem mobil) ve cihazda manuel senaryo — Android sahte
konumla evden çıkış simülasyonu, rota başlatma, aynı yerden ikinci geçişte bildirim çıkmadığının
doğrulanması.

## 12. Değişecek dosyalar

**Yeni**
- `ArX Task mobile/src/lib/route-opportunities.ts`
- `ArX Task mobile/src/lib/route-opportunities.test.ts`
- `ArX Task mobile/src/lib/geofence-throttle.ts`
- `ArX Task mobile/src/components/route-map.tsx`

**Değişen**
- `ArX Task mobile/src/lib/geofencing.ts` — yeni bölge türü, `resyncGeofences`, genişleyen
  `persistAutoRouteInputs`, `handleHomeExit` akışı, throttle kontrolü, `regionId` yükü
- `ArX Task mobile/src/lib/app-data-context.tsx` — `rebuildGeofences` içinde en-yakın-N modu
- `ArX Task mobile/src/lib/notifications.ts` — `geofence-reminder` kategorisi, `mute-today` dalı
- `ArX Task mobile/app/(app)/route-planner.tsx` — "Yol üzerinde" kartı, harita, genelleşen modal
- `ArX Task mobile/src/lib/i18n.tsx` — yeni metinler, mevcut 6 dilin tamamı (en, de, tr, ar, fr, nl)
- `ArX Task mobile/package.json` — `react-native-webview`, `tsx`, `test:logic`

**Değişmeyen**
- `api/ArxTask.Api/Program.cs` ve tüm sunucu tarafı

## 12.1 Önerilen uygulama sırası

Tek bir plan, üç aşama. Her aşama kendi başına çalışır durumda bırakılabilir:

1. **Çekirdek mantık** — `route-opportunities.ts` + testleri + `geofence-throttle.ts`.
   Cihaz gerektirmez, testlerle doğrulanır.
2. **Tetikleyiciler ve bildirimler** — `geofencing.ts`, `app-data-context.tsx`,
   `notifications.ts`, `i18n.tsx`. Bu aşama bittiğinde özellik fiilen çalışır: fırsatlar
   bildirimle gelir.
3. **Görsel katman** — "Yol üzerinde" kartı ve uygulama içi harita
   (`route-planner.tsx`, `route-map.tsx`, `react-native-webview`). Yeni native bağımlılık
   burada girer, dolayısıyla derleme riski de bu aşamada yalıtılmış olur.

## 13. Kapsam dışı

- Bildirimden görevi tamamlama (mevcut "Tamamlandı" akışı sunucudan gelen eylem token'ı
  gerektiriyor; geofence bildirimlerinde böyle bir token yok — ayrı iş)
- iOS derlemesi
- Fırsatların sunucuda saklanması veya analitiği
- Rota bitince özel temizlik — tarih bazlı sıfırlama yeterli

## 14. Açık riskler

1. **OSM döşeme politikası** — `tile.openstreetmap.org` yüksek hacimli uygulama kullanımını
   önermiyor. Birkaç kullanıcıda sorun değil; hacim artarsa anahtarlı bir sağlayıcıya geçilir.
2. **Yeni native bağımlılık** — `react-native-webview` yeni bir APK derlemesi gerektirir.
   Aynı keystore ile derlenmeli (`ArX Task mobile/credentials/planix-release.keystore`),
   yoksa kullanıcılar güncellemeyi mevcut kurulumun üzerine kuramaz.
3. **Bölge bütçesi çekişmesi** — bugünün görev firması sayısı yüksekse fırsat bölgesi hiç
   kurulmayabilir. Bilinçli öncelik kararı; sorun olursa bugünün firmalarına da bir üst sınır
   konur.
