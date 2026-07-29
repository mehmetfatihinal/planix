# Görevsiz Günde Yakın İş Hatırlatma — Tasarım

Tarih: 2026-07-29
Durum: Onaylandı, uygulamaya hazır
Önceki tasarım: [2026-07-27 Yol Üzeri Görev Hatırlatma](2026-07-27-yol-uzeri-gorev-hatirlatma-design.md)

## 1. Problem

Önceki tasarım "rotasız gün de çalışsın" diyordu (§3, §4.3) ve mekanizmanın çoğu kuruldu. Ama
kullanıcının senaryosu — *"rotayı başlatmasam, hatta bugün hiç görevim olmasa bile dışarı
çıktığımda bana yapılacakları hatırlatsın"* — üç yerde tıkalı:

**1. Evden çıkış işleyicisi yalnızca bugünün görevlerini görüyor.**
`persistAutoRouteInputs` gövdesi plana göre "tüm açık görevler"e genişletildi
(`ArX Task mobile/src/lib/geofencing.ts:426`) ve `AutoRouteInputs` tipinin yorumu da bunu
söylüyor (satır 85). Ama tek çağıran taraf güncellenmedi:

```ts
// ArX Task mobile/src/lib/app-data-context.tsx:334
await persistAutoRouteInputs(todayTasks, data.companies).catch(() => undefined);
```

`todayTasks` yalnızca `dueDate === bugün` olan görevleri içeriyor (satır 313-315). Sonuç: bugün
görevi olmayan bir sabah evden çıkıldığında `handleHomeExit` içindeki `openTasks` boş geliyor,
`findTaskOpportunities` hiçbir şey döndürmüyor ve özet bildirim
`{ title: "Günaydın!", body: "Bugün planlı göreviniz yok." }` ile kapanıyor
(`route-opportunities.ts:183`). Kullanıcının sorduğu senaryo tam olarak burada ölüyor.

**2. İzlenen firma kümesi konumla birlikte kaymıyor.**
Rota yokken en yakın firmalar bir kez hesaplanıyor: uygulama önde açıkken (`rebuildGeofences`,
`app-data-context.tsx:341`) veya evden çıkışta. İşletim sistemi bizi yalnızca **izlediğimiz** bir
bölgeye girince uyandırdığı için, uygulama kapalıyken hiç izlenmeyen bir semte gidildiğinde
uyanma olayı hiç gerçekleşmiyor. Sabah evde hesaplanan liste akşama kadar aynı kalıyor.

**3. Kota gereksiz yere dar.**
`MAX_TASK_OPPORTUNITY_REGIONS = 6` (`route-opportunities.ts:90`) hem rota günü hem görevsiz gün
için kullanılıyor. Görevsiz günde bugünün görev firmaları hiç bölge tüketmediği için OS bütçesi
boş duruyor, ama kota yine 6'da kalıyor.

Ek olarak özelliğin tamamı ev konumunun kayıtlı olmasına bağlı; kayıtlı değilse hiçbir tetikleyici
çalışmıyor ve kullanıcı bunu yalnızca Ayarlar'daki küçük bir rozetten anlayabiliyor
(`app/(app)/settings.tsx:186`).

## 2. Amaç

Bugün planlı görevi olmayan bir günde de kullanıcı dışarı çıktığında (a) çıkış anında "yakınında
şunlar var" özeti alsın, (b) gün içinde hareket ettikçe izlenen firma kümesi konumuyla birlikte
kaysın, (c) izlenen firma sayısı boş duran bölge bütçesi kadar geniş olsun.

## 3. Kapsam kararları

| Konu | Karar |
|---|---|
| Hatırlatma kapsamı | Açık görevler (firma koordinatı olanlar) **+** açık alışveriş maddeleri |
| Firmasız / adressiz görevler | **Kapsam dışı** — konum eşleşmesi mümkün değil |
| Görevsiz günde izlenen firma sayısı | **24** (rota gününde 6 olarak kalır) |
| OS bölge bütçesi | Android **100**, iOS 20 (iOS derlemesi hâlâ kapsam dışı) |
| Konum değişiminde tazeleme | Son hesap konumunda **çıkışta tetiklenen tazeleme çemberi** |
| Çember yarıçapı | `clamp(enUzakSeçilenMesafe / 2, 3 km, 10 km)` |
| Rota günlerinde tazeleme | **Yok** — o sabahki koridor listesi korunur |
| Ev konumu kayıtlı değilse | Ana ekranda uyarı kartı + kart yine de yakın işleri listeler |
| Bildirim eşiği | Değişmiyor — firmaya **1 km** |
| Gürültü kontrolü | Değişmiyor — `geofence-throttle.ts`, yer başına günde bir + "Bugün sorma" |
| API değişikliği | **Yok** |

## 4. Mimari

Üç bağımsız parça. Her biri tek başına sevk edilebilir durumda bırakılabilir.

### 4.1 A — Veri hattı düzeltmesi

`app-data-context.tsx:334` çağrısı `data.tasks` alacak şekilde değişir:

```ts
await persistAutoRouteInputs(data.tasks, data.companies).catch(() => undefined);
```

Başka hiçbir şey değişmez, çünkü gerekli elemeler zaten iki tarafta da yapılıyor:

- `persistAutoRouteInputs` kendi içinde `status !== "done" && Boolean(companyId)` filtresini
  uyguluyor, `taskSortKey` ile yakın vadeliden uzağa sıralıyor ve `MAX_OPEN_TASK_SNAPSHOT` (300)
  ile kırpıyor (`geofencing.ts:428-431`).
- `handleHomeExit` bugünün rotasını kendi içinde `task.dueDate === today` filtresiyle çıkarıyor
  (`geofencing.ts:313`), dolayısıyla rota planı ve `createRoute` çağrısı etkilenmez.

**Etki.** Görevsiz sabah evden çıkışta koridor `[konum]` olur, `bufferMeters` `null` gider ve
en yakın açık iş firmaları bulunur; özet bildirim
`{ title: "Bugün planlı göreviniz yok", body: "Yakınınızda 3 açık iş var" }` olarak çıkar
(`route-opportunities.ts:176-181`).

**Alışveriş kısmı sunucu tarafında değişiklik gerektirmez.** `handleHomeExit` tek noktalı koridoru
`routeErrandStops`'a zaten gönderiyor (`geofencing.ts:356-360`); uç nokta en az 1 nokta kabul
ediyor (`api/ArxTask.Api/Program.cs:1057`) ve `GetRouteCorridor` iki noktadan az girdide OSRM'e
hiç gitmeden noktayı olduğu gibi döndürüyor (`Program.cs:5973`). Overpass sorgusu o tek noktanın
çevresinde çalışır.

### 4.2 B — Tazeleme çemberi

**Neden "bölgeye girince yeniden hesapla" yetmiyor:** OS bizi yalnızca izlenen bir bölgenin
sınırında uyandırır. Hiç izlenmeyen bir semtte hiçbir sınır geçilmediği için uyanma olayı da
oluşmaz. Uzak semt sorununu çözmek için, **her nerede olursak olalım etrafımızda bir sınır
bulunmalı.**

Çözüm: en yakın-N hesabının yapıldığı konumun etrafına, yalnızca **çıkışta** tetiklenen tek bir
bölge kurulur.

- Bölge kimliği: `zone` (yeni sabit `NEARBY_ZONE_REGION_ID`).
- `notifyOnEnter: false`, `notifyOnExit: true` — bildirim üretmez.
- Yarıçap: `clamp(enUzakSeçilenFirmanınMesafesi / 2, 3000, 10000)` metre. Gerekçe: en uzak
  seçilen firma D metredeyse, listeye yeni bir firma girmesi için kabaca D/2 kadar yer
  değiştirmek gerekir; daha erken uyanmak boşuna. Alt sınır aşırı sık tetiklenmeyi, üst sınır
  şehirlerarası tek bir görevin çemberi tüm bölgeye yaymasını engeller.
- Seçilmiş firma yoksa çember kurulmaz (tazelenecek bir liste yok).

Yeni saf fonksiyon, `route-opportunities.ts` içinde:

```ts
export function nearbyZoneRadiusMeters(opportunities: Pick<TaskOpportunity, "distanceToRouteMeters">[]): number | null;
```

Boş listede `null` döner. Saf tutulmasının nedeni mevcut test koşucusuyla doğrulanabilmesi.

**Tetiklenme akışı.** `TaskManager` arka plan görevindeki `Exit` dalı (`geofencing.ts:173-178`)
bugün yalnızca `HOME_REGION_ID` biliyor; ikinci bir dal eklenir:

```
Exit → identifier === "home"  → handleHomeExit()      (mevcut)
Exit → identifier === "zone"  → refreshNearbyOpportunities()   (yeni)
```

`refreshNearbyOpportunities()` (geofencing.ts içinde yeni, dışa açık):

1. Bugünün kaydı `source === "route"` ise **hiçbir şey yapmaz** — o sabah kurulan koridor listesi
   gün içinde ezilmez (mevcut kural, `app-data-context.tsx:340`).
2. `arx:auto-route-inputs` okunur (A sayesinde artık tüm açık görevleri içerir).
3. Konum alınır: önce `getLastKnownPositionAsync` (ucuz), yoksa
   `getCurrentPositionAsync({ accuracy: Balanced })`. İkisi de başarısızsa çıkılır.
4. `findTaskOpportunities` çalışır: `corridor: [konum]`, `bufferMeters: null`,
   `excludeCompanyIds` = bugünün görev firmaları, `limit: MAX_NEARBY_OPPORTUNITY_REGIONS`.
5. Sonuç `arx:task-opportunities`'e `source: "nearby"` ve yeni `origin` alanıyla yazılır.
6. `resyncGeofences()` — bölgeler yeniden kurulur; çember de yeni konumda yeniden doğar.

Bildirim atmaz. Kullanıcı yeni semtte bir firmanın 1 km'sine girdiğinde mevcut
`task-opportunity` bildirimi çıkar.

**Alışveriş sorgusu yapmaz.** `routeErrandStops` çağrılmaz: headless uyanmada ağ + Overpass
maliyeti taşımak istemiyoruz ve gün içinde her 5–10 km'de bir sorgu atmak dış servise karşı da
saygısız olur. Dükkan listesi o günkü evden çıkış hesabından (veya ana ekran kartındaki manuel
düğmeden) geldiği gibi kalır.

Headless görev hiçbir koşulda hata fırlatmaz — mevcut `try/catch` kalıbı korunur.

### 4.3 C — Ana ekran kartı

Yeni bileşen `src/components/nearby-work-card.tsx`. Ana ekran hâlihazırda 496 satır
(`app/(app)/index.tsx`), oraya gömülmez.

**Ev konumu uyarısı.** `settings.homeLatitude/homeLongitude` kullanılabilir koordinat değilse
kartın üstünde uyarı satırı ve `/settings`'e giden bir düğme. Aynı ölçüt zaten
`rebuildGeofences` içinde kullanılıyor (`app-data-context.tsx:373-376`).

**Yakın işler listesi.** Anlık ve tamamen yerel hesaplanır — veri de konum da React ağacında:

```ts
findTaskOpportunities({
  tasks: openTasks,                         // status !== "done" && companyId
  companies: data.companies,
  corridor: [locationState.coords],
  bufferMeters: null,
  excludeCompanyIds: bugününGörevFirmaları,  // ajandada zaten görünüyorlar
  limit: MAX_NEARBY_OPPORTUNITY_REGIONS
})
```

Görüntüleme kuralları:

- Kartta ilk **8** satır; altında "tümü (N)" satırı listeyi açar. Bildirimler 24'ünün hepsi için
  kurulu kalır; bu yalnızca görüntüleme sınırıdır.
- **Gösterim üst mesafesi 10 km** (`NEARBY_CARD_MAX_METERS`). Geofence tarafındaki "üst mesafe
  sınırı yok" kararı (önceki tasarım §4.3) değişmez; ekranda 200 km ötedeki firmayı listelemek
  gürültü olur.
- Konum yoksa liste yerine izin isteyen bir satır gösterilir.

**Alışveriş bölümü.** `arx:errand-geofences` deposundan okunur (`loadErrandGeofences`,
`geofencing.ts:476`) — o gün evden çıkışta yazılmışsa doludur. Boşsa "Yakındaki dükkanları ara"
düğmesi tek seferlik `routeErrandStops` sorgusunu tetikler ve sonucu aynı depoya yazar. Her
uygulama açılışında Overpass'a gidilmez.

### 4.4 Sabitler

`route-opportunities.ts`:

```ts
export const ON_THE_WAY_BUFFER_METERS = 1000;          // değişmiyor
export const MAX_ROUTE_OPPORTUNITY_REGIONS = 6;        // rota günü — koridor zaten daraltıyor
export const MAX_NEARBY_OPPORTUNITY_REGIONS = 24;      // görevsiz gün
export const MAX_OPEN_TASK_SNAPSHOT = 300;             // değişmiyor
export const NEARBY_ZONE_MIN_RADIUS_METERS = 3000;
export const NEARBY_ZONE_MAX_RADIUS_METERS = 10000;
```

Mevcut `MAX_TASK_OPPORTUNITY_REGIONS` kaldırılır; her çağrı yerinde iki yeni sabitten uygun olanı
kullanılır. İsim değişimi bilinçli — aynı adın iki farklı anlamda kullanılması bugünkü kırpma
hatasının (§5) kaynağı.

`nearby-work-card.tsx`:

```ts
const NEARBY_CARD_MAX_METERS = 10000;
const NEARBY_CARD_VISIBLE_ROWS = 8;
```

## 5. Kalıcılık

| Anahtar | Durum | Değişiklik |
|---|---|---|
| `arx:task-opportunities` | **genişliyor** | `origin?: { latitude, longitude }` alanı eklenir — çemberin merkezi |
| `arx:auto-route-inputs` | değişmiyor | İçeriği A sayesinde artık gerçekten tüm açık görevler |
| `arx:geofence-sync-input` | değişmiyor | |
| `arx:geofence-notified` | değişmiyor | |
| `arx:errand-geofences` | değişmiyor | Ana ekran kartı bu depodan okur |
| `arx:auto-route-date` | değişmiyor | |

`origin` isteğe bağlıdır: eski cihazlarda kayıt bu alan olmadan durur, o gün çember kurulmaz,
ilk yeni hesapta gelir. `loadStoredTaskOpportunities` doğrulaması `Array.isArray(parsed?.items)`
olduğu için geriye dönük uyumluluk kendiliğinden sağlanır (`geofencing.ts:517`).

**Kırpma hatası.** `persistTaskOpportunities` (`geofencing.ts:505`) ve `loadTaskOpportunities`
(satır 527) listeyi sabit `MAX_TASK_OPPORTUNITY_REGIONS` ile kırpıyor. Bu iki kırpma kaynağa
duyarlı hale gelmezse 24 firma diske 6 olarak yazılır ve bu tasarımın hiçbir etkisi görünmez:

```ts
const limitForSource = (source: "route" | "nearby") =>
  source === "route" ? MAX_ROUTE_OPPORTUNITY_REGIONS : MAX_NEARBY_OPPORTUNITY_REGIONS;
```

## 6. Bölge bütçesi

```ts
const MAX_REGIONS = Platform.OS === "android" ? 100 : 20;
```

Bugünkü tek sabit 20 ve yorumu "iOS 20 ile sınırlıyor, Android'i de tutarlı tutalım" diyor
(`geofencing.ts:39`). Android'in gerçek sınırı uygulama başına 100; iOS derlemesi kapsam dışı
olduğu için Android'i kısıtlamanın bir karşılığı yok. iOS ileride geldiğinde 20'lik yol
kendiliğinden korunur.

Fiili kullanım tavanı ~34 bölge (ev 1 + çember 1 + fırsat 24 + dükkan 8), yani sınıra
yaslanmıyoruz.

**Yeni öncelik sırası** (`syncGeofences`):

```
1. Ev bölgesi                        (1, yalnızca çıkış)
2. Tazeleme çemberi                  (1, yalnızca çıkış)   ← YENİ, sadece görevsiz günde
3. Bugünün görev firmaları           (sınırsız)
4. Yol üzeri / yakın görev fırsatları (rota: 6, görevsiz: 24)
5. Yol üzeri alışveriş dükkanları    (maks 8)
6. Alışveriş satıcı firmaları        (kalan)
```

Çember ev'in hemen ardında ikinci sırada: bütçe dışı kalırsa tazeleme mekanizmasının tamamı
sessizce ölür, dolayısıyla tek bir fırsat bölgesinden daha değerli.

**Çember yalnızca `source === "nearby"` kaydında kurulur.** Rota günlerinde o sabahki koridor
listesi geçerli kabul edildiği için (§3) tazelenecek bir şey yoktur; çember o günlerde hiç
kurulmaz ve bütçe tüketmez.

**Alışveriş açlığa düşmesin.** Fırsatlar yerleştirilmeden önce `syncGeofences` hem dükkanları
(`loadErrandGeofences`) hem satıcıları (`input.sellers`) zaten biliyor. Fırsat kotası, alışveriş
için **sınırlı** bir pay ayrılarak hesaplanır:

```ts
const SHOPPING_RESERVE = 4;
const shoppingNeed = Math.min(errands.length + sellers.length, SHOPPING_RESERVE);
const allowance = Math.max(0, MAX_REGIONS - regions.length - shoppingNeed);
```

Payın üst sınırlı olması önemli: rezerve edilen miktar `errands.length + sellers.length` ile
sınırsız büyüseydi, daha düşük öncelikli alışveriş bölgeleri daha yüksek öncelikli fırsatları
bastırırdı — yukarıdaki sıralamanın tersi. Bu hâliyle alışveriş en fazla 4 slot garantiler,
gerisini öncelik sırası belirler. Android'de 100 bütçeyle kısıt pratikte hiç devreye girmez;
iOS'ta 20 bütçeyle doğru davranışı garanti eder.

## 7. Bildirimler

Yeni bildirim türü yok, mevcut metinler değişmiyor. Tazeleme çemberi sessizdir.

Gürültü kontrolü değişmiyor: `geofence-throttle.ts` yer başına `task-opportunity` için günde bir
bildirime izin veriyor ve her geofence bildiriminde "Bugün sorma" eylemi var. 24 firma izlenmesi
bildirim sıklığını artırmaz — yalnızca 1 km'sine *girilen* firmalar bildirim üretir.

Bir tazeleme, listeden düşen bir firmanın o gün için `arx:geofence-notified` kaydını **silmez**;
kullanıcı geri dönerse aynı gün ikinci bildirim yine çıkmaz. Bu istenen davranış.

## 8. Ekran değişiklikleri

Ana ekran (`app/(app)/index.tsx`) yeni `NearbyWorkCard` bileşenini render eder. Konumu: bugünün
ajandasından **sonra** — bugünün işleri her zaman önce gelir. Bugün görev yoksa kart mevcut boş
durumun yerini alır.

Rota planı ekranındaki "Yol üzerinde" kartına dokunulmaz. i18n anahtarları altı dilin tamamına
eklenir (en, de, tr, ar, fr, nl) — mevcut `route.onTheWay.*` kalıbının yanına `nearby.*`.

## 9. Hata yönetimi ve bozulma

| Durum | Davranış |
|---|---|
| Ev konumu kayıtlı değil | Çıkış tetikleyicisi yok; kart uyarı gösterir, liste yine çalışır |
| Konum izni yok | Çember kurulmaz, kart izin satırı gösterir; mevcut bozulma yolu |
| Ağ yok | Görev kısmı çalışır, alışveriş atlanır (mevcut davranış) |
| `origin` alanı olmayan eski kayıt | O gün çember kurulmaz, ilk hesapta gelir |
| Çember çıkışında konum alınamıyor | Tazeleme atlanır, eski liste durur; bir sonraki çıkışta tekrar denenir |
| Android çember çıkışını geç bildirdi | Hatırlatma birkaç dakika gecikir — kabul edilen risk |
| Expo Go | Geofence zaten devre dışı; kart çalışır |

## 10. Test

Mevcut koşucu (`npm run test:logic` — `node --test --import tsx`) genişletilir.
`route-opportunities.test.ts`'e eklenecekler:

1. `nearbyZoneRadiusMeters` — boş listede `null`.
2. En uzak firma 4 km → yarıçap 3 km (alt sınır devrede).
3. En uzak firma 12 km → yarıçap 6 km (clamp aralığında).
4. En uzak firma 40 km → yarıçap 10 km (üst sınır devrede).
5. `findTaskOpportunities` `limit: 24` ile 24'ten fazla aday arasından tam 24 döner, sıralama
   mesafeye göre bozulmaz.

Ek doğrulama:

- `npm run typecheck` — hem kök hem `ArX Task mobile`.
- Cihazda sahte konumla: (a) bugün görevi olmayan bir günde evden çıkış → özet bildirimde iş
  sayısı görünüyor; (b) 5–10 km ötesine atlama → çember tetikleniyor, yeni semtteki firma
  izlemeye giriyor; (c) aynı firmadan ikinci geçişte bildirim çıkmıyor; (d) ev konumu silinmiş
  hesapta ana ekran uyarısı görünüyor.
- 24 bölge izlenirken bir gün boyunca cihazın pil raporunda uygulamanın konum tüketimi
  gözlenir. Beklenti: OS geofencing donanım destekli olduğu ve ek bir arka plan servisi
  açılmadığı için kayda değer artış olmaması.

## 11. Değişecek dosyalar

**Yeni**
- `ArX Task mobile/src/components/nearby-work-card.tsx`

**Değişen**
- `ArX Task mobile/src/lib/route-opportunities.ts` — sabit ayrımı, `nearbyZoneRadiusMeters`
- `ArX Task mobile/src/lib/route-opportunities.test.ts` — yeni testler
- `ArX Task mobile/src/lib/geofencing.ts` — `MAX_REGIONS` platform ayrımı, `zone` bölgesi ve
  `Exit` dalı, `refreshNearbyOpportunities`, kaynağa duyarlı kırpma, fırsat kotası hesabı,
  `StoredTaskOpportunities.origin`
- `ArX Task mobile/src/lib/app-data-context.tsx` — `persistAutoRouteInputs(data.tasks, …)`,
  `nearby` hesabında yeni limit ve `origin` yazımı
- `ArX Task mobile/app/(app)/index.tsx` — `NearbyWorkCard` yerleşimi
- `ArX Task mobile/src/lib/i18n.tsx` — `nearby.*` anahtarları, altı dil

**Değişmeyen**
- `api/ArxTask.Api/Program.cs` ve tüm sunucu tarafı
- `ArX Task mobile/src/lib/geofence-throttle.ts` ve `geofence-throttle-state.ts`
- `ArX Task mobile/app/(app)/route-planner.tsx`, `src/components/route-map.tsx`

## 12. Önerilen uygulama sırası

1. **A — Veri hattı ve kota.** `app-data-context.tsx:334` düzeltmesi, sabit ayrımı, kaynağa
   duyarlı kırpma, `MAX_REGIONS` platform ayrımı, fırsat kotası hesabı. Bu aşama bittiğinde
   kullanıcının sorduğu senaryo (görevsiz günde çıkış özeti) fiilen çalışır.
2. **B — Tazeleme çemberi.** `nearbyZoneRadiusMeters` + testleri, `origin` alanı, `zone` bölgesi,
   `Exit` dalı, `refreshNearbyOpportunities`.
3. **C — Ana ekran kartı.** `nearby-work-card.tsx`, ana ekran yerleşimi, i18n.

Yeni native bağımlılık yok; `react-native-webview` bu dalda zaten girmiş durumda. Yayın için
mevcut keystore ile yeni bir APK yeterli
(`ArX Task mobile/credentials/planix-release.keystore`).

## 13. Kapsam dışı

- Firmasız / adressiz görevler (konum eşleşmesi mümkün değil)
- Rota günlerinde tazeleme çemberi — o gün koridor listesi geçerli kabul edilir
- Arka planda periyodik konum takibi
- iOS derlemesi
- Ev konumunun otomatik öğrenilmesi
- Fırsatların sunucuda saklanması veya analitiği

## 14. Açık riskler

1. **Android geofence sınırı.** 100 bölge belgelenmiş sınır, ama cihaz üreticilerinin agresif
   pil yönetimi bunu pratikte düşürebilir. Fiili kullanımımız ~34, yani geniş pay var; yine de
   ilk cihaz testinde `startGeofencingAsync` sessizce bölge düşürüyor mu diye bakılmalı.
2. **Büyük yarıçaplı çember gecikmesi.** Android geofence çıkışını birkaç dakika gecikmeli
   bildirebilir; yeni semtteki ilk hatırlatma "bir adım geç" gelebilir.
3. **Yeniden kurulum boşluğu.** `startGeofencingAsync` tüm bölge kümesini değiştiriyor; tazeleme
   sırasında çok kısa bir izlemesiz an oluşur. Mevcut her `syncGeofences` çağrısında da var olan
   bir davranış, tazeleme onu sıklaştırır.
4. **Anlık görüntü bayatlığı.** Fırsat bildirimi başka cihazda kapatılmış bir görev için
   çıkabilir; dokunulduğunda gerçek durum görünür (önceki tasarımda kabul edilmiş risk).
