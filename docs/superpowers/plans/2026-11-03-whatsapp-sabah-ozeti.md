# WhatsApp Sabah Özeti — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her kullanıcıya kendi seçtiği saatte, o günün görevlerini listeleyen tek bir WhatsApp mesajı gönderen altyapı (Meta bağlantısı yokken dry-run).

**Architecture:** Saf mantık (numara normalleştirme, mesaj oluşturma, "saati geldi mi", ayar kuralları) yeni `api/ArxTask.Api/WhatsAppDigest.cs` dosyasında public statik sınıflar olarak durur ve yeni xUnit projesiyle test edilir. `WhatsAppDigestService` (aynı dosya) her 5 dakikada çalışan Hangfire işiyle zamanı gelen kullanıcılara `IWhatsAppSender` üzerinden gönderir ve her denemeyi `WhatsAppMessages` tablosuna yazar. Web ve mobil ayar ekranlarına numara / aç-kapa / saat / test butonu eklenir.

**Tech Stack:** ASP.NET Core 10 minimal API, EF Core SQLite, Hangfire, `TimeProvider`; xUnit + `Microsoft.Extensions.TimeProvider.Testing`; Next.js (web), Expo/React Native (mobil); Meta WhatsApp Cloud API (Graph API).

**Spec:** `docs/superpowers/specs/2026-11-03-whatsapp-sabah-ozeti-design.md`

## Global Constraints

- Varsayılanlar: özet **kapalı** (`WhatsAppDigestEnabled = false`), saat **`08:00`**.
- Saatler `AppTime.UserZone` (Türkiye) ile yorumlanır; "bugün" = `AppTime.UserToday(now)`.
- Mesajlar Türkçe. Şablon: `{{1}}` = isim, `{{2}}` = görev listesi; `{{2}}` içinde satır sonu/sekme yok, ayırıcı tam olarak `" • "`.
- En fazla **15** görev listelenir, fazlası `"+N görev daha"`.
- Gizli bilgiler (`WhatsApp__AccessToken` vb.) yalnızca ortam değişkeninde; repoya ve loga yazılmaz.
- Sunucu ayarları: `WhatsApp__AccessToken`, `WhatsApp__PhoneNumberId`, `WhatsApp__TemplateName`, `WhatsApp__TemplateLanguage` (varsayılan `tr`), `WhatsApp__ApiVersion` (varsayılan `v23.0`).
- Kullanıcı başına günde en fazla **3** gerçek test gönderimi.
- Yeni kolonlar `EnsureColumn`, yeni tablo `CREATE TABLE IF NOT EXISTS` ile (mevcut desen, migration yok).

## Review Focus

1. **Gece yarısına yakın saat** (ör. 23:50): telafi aralığı ertesi güne taşmamalı, ertesi gün 00:xx'te "dünün" mesajı gitmemeli → Task 1 `ShouldSend` testi.
2. **Görev başlığında satır sonu / çok boşluk** (Meta parametresini reddeder) → Task 1 composer testi: `\n`, `\t`, 5 boşluk tek boşluğa iner.
3. **Sunucu yeniden başlayıp işi saatler sonra çalıştırırsa**: seçilen saatten 60 dk sonra artık gönderilmez → Task 1 `ShouldSend` testi.
4. **Dry-run modunda her 5 dakikada tekrar kayıt** (kayıt şişmesi): dry-run modundayken o gün ikinci dry-run kaydı oluşmaz → Task 3 servis testi.
5. **Numara silinince özet açık kalması**: numara boşaltılırsa özet kapanır → Task 1 ayar kuralı testi.

---

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `api/ArxTask.Api/WhatsAppDigest.cs` (yeni) | `WhatsAppPhone`, `WhatsAppDigestComposer`, `WhatsAppDigestSchedule`, `WhatsAppSettingsRules`, `WhatsAppMessageEntity`, `IWhatsAppSender` + `WhatsAppCloudSender`, `IWhatsAppDigestService` + `WhatsAppDigestService` |
| `api/ArxTask.Api/Program.cs` | `AppUser` alanları, `EnsureColumn`/`CREATE TABLE`, `DbSet`, DI, recurring job, `/settings` istek/yanıt, `POST /settings/whatsapp/test` |
| `api/ArxTask.Api.Tests/` (yeni) | xUnit projesi |
| `types/business.ts`, `lib/api-client.ts`, `lib/app-state.tsx`, `components/pages/settings-page.tsx`, `locales/*.json` | Web ayarları |
| `ArX Task mobile/src/types/business.ts`, `ArX Task mobile/src/lib/api.ts`, `ArX Task mobile/app/(app)/settings.tsx` | Mobil ayarları |
| `docs/whatsapp-kurulum.md` (yeni) | Meta kurulum adımları + şablon metni |

---

### Task 1: Saf mantık + test projesi

**Files:**
- Create: `api/ArxTask.Api/WhatsAppDigest.cs`
- Create: `api/ArxTask.Api.Tests/ArxTask.Api.Tests.csproj`, `api/ArxTask.Api.Tests/WhatsAppDigestLogicTests.cs`

**Interfaces:**
- Produces:
  - `public static class WhatsAppPhone { public static string? Normalize(string? input); public static string ToGraphRecipient(string e164); }` — `Normalize`: boş/whitespace → `""`; boşluk, `-`, `(`, `)` atılır; `00` → `+`; `0` + 10 hane → `+90…`; `5` ile başlayan 10 hane → `+90…`; sonuç `+` + 8–15 hane değilse `null`. `ToGraphRecipient` baştaki `+`'yı atar.
  - `public sealed record DigestTaskItem(string Title, string? DueDate, string? DueTime, string Status, bool IsHabit, string? CompanyName);`
  - `public sealed record WhatsAppDigestContent(string NameParam, string ListParam, string PreviewText, int TodayCount);`
  - `public static class WhatsAppDigestComposer { public static WhatsAppDigestContent? Compose(string userName, string userEmail, IReadOnlyList<DigestTaskItem> tasks, DateOnly today); public static WhatsAppDigestContent ComposeEmpty(string userName, string userEmail); }`
  - `public static class WhatsAppDigestSchedule { public static readonly TimeSpan CatchUpWindow = TimeSpan.FromMinutes(60); public static bool ShouldSend(DateTime localNow, string chosenTime); }`
  - `public static class WhatsAppSettingsRules { public static string? Apply(AppUser user, string? number, bool? enabled, string? time); }` — hata metni ya da `null`.

- [ ] **Step 1: Test projesini oluştur**

`dotnet new xunit -o api/ArxTask.Api.Tests -f net10.0`, `dotnet add api/ArxTask.Api.Tests reference api/ArxTask.Api/ArxTask.Api.csproj`, `dotnet add api/ArxTask.Api.Tests package Microsoft.Extensions.TimeProvider.Testing`. Şablonun `UnitTest1.cs` dosyasını sil.

- [ ] **Step 2: Failing testleri yaz** (`WhatsAppDigestLogicTests.cs`)

```csharp
[Theory]
[InlineData("0532 123 45 67", "+905321234567")]
[InlineData("5321234567", "+905321234567")]
[InlineData("+49 151 2345 6789", "+4915123456789")]
[InlineData("0049-151-23456789", "+4915123456789")]
[InlineData("   ", "")]
public void Normalize_accepts(string input, string expected) => Assert.Equal(expected, WhatsAppPhone.Normalize(input));

[Theory] [InlineData("abc")] [InlineData("123")] [InlineData("+12")]
public void Normalize_rejects(string input) => Assert.Null(WhatsAppPhone.Normalize(input));

[Fact] public void Compose_orders_timed_first_and_appends_company()
// today=2026-11-03; görevler: "Süt al"(saatsiz), "Teklif gönder" 14:00 firma "Mara Market", "Montaja git" 10:00 firma "Ensar Döner"
// → ListParam == "10:00 Montaja git (Ensar Döner) • 14:00 Teklif gönder (Mara Market) • Süt al"
// → NameParam == "Mehmet" (userName "Mehmet Fatih"), PreviewText == "Günaydın Mehmet, bugün yapılacakların: " + ListParam, TodayCount == 3

[Fact] public void Compose_returns_null_when_no_task_today()   // yalnızca dünkü açık görev var → null
[Fact] public void Compose_excludes_done_habits_and_pending_approval() // bugünkü done / IsHabit / "pending_approval" listelenmez
[Fact] public void Compose_counts_overdue_from_earlier_dates() // 1 bugün + 2 dünden açık (biri saatsiz) → ListParam "… • Ayrıca 2 gecikmiş işin var."
[Fact] public void Compose_caps_at_15()                         // 18 görev → 15 satır + " • +3 görev daha"
[Fact] public void Compose_sanitizes_whitespace()               // başlık "Ara\n  ve\t     sor" → "Ara ve sor"; ListParam '\n' veya '\t' içermez
[Fact] public void Compose_name_falls_back_to_email_local_part() // userName "" , email "ali@x.com" → NameParam "ali"
[Fact] public void ComposeEmpty_text()                          // ListParam == "Bugün planlanmış görevin yok."

[Theory]
[InlineData("2026-11-03 07:59", "08:00", false)]
[InlineData("2026-11-03 08:00", "08:00", true)]
[InlineData("2026-11-03 08:59", "08:00", true)]
[InlineData("2026-11-03 09:00", "08:00", false)]
[InlineData("2026-11-03 23:55", "23:50", true)]
[InlineData("2026-11-04 00:10", "23:50", false)]
[InlineData("2026-11-03 08:00", "bozuk", false)]
public void ShouldSend_window(string now, string chosen, bool expected)

[Fact] public void Rules_enabling_without_number_fails()   // Apply(user, null, true, null) != null, user.WhatsAppDigestEnabled false kalır
[Fact] public void Rules_invalid_number_fails()            // "abc" → "Geçersiz WhatsApp numarası."
[Fact] public void Rules_clearing_number_disables()        // önce "+905321234567"+enabled, sonra Apply(user,"",null,null) → Enabled false, Number ""
[Fact] public void Rules_invalid_time_fails()              // "25:00" → hata; "07:15" → kabul, user.WhatsAppDigestTime "07:15"
```

- [ ] **Step 3: Testleri çalıştır, derlenmediğini/kırmızı olduğunu gör**

Run: `dotnet test api/ArxTask.Api.Tests` → Expected: derleme hatası (tipler yok).

- [ ] **Step 4: `WhatsAppDigest.cs` içinde Interfaces'teki sınıfları yaz**

`AppUser`'a (Program.cs) üç alan ekle: `public string WhatsAppNumber { get; set; } = ""; public bool WhatsAppDigestEnabled { get; set; } public string WhatsAppDigestTime { get; set; } = "08:00";` (`Rules` bunlara yazar). Composer: liste parametresi en fazla 900 karakter (aşarsa son görevler `+N görev daha`ya düşer). `ShouldSend`: `chosen <= localNow.TimeOfDay < chosen + CatchUpWindow`, pencere gece yarısında kesilir.

- [ ] **Step 5: Testleri çalıştır** → `dotnet test api/ArxTask.Api.Tests` Expected: tümü PASS.

- [ ] **Step 6: Commit** — `feat(api): WhatsApp ozeti saf mantigi ve test projesi`

---

### Task 2: Veri modeli, ayarlar API'si, gönderici

**Files:**
- Modify: `api/ArxTask.Api/Program.cs` (EnsureColumn bloğu ~1477, `Reports` CREATE TABLE'ın ardı ~1631, `ArxTaskDbContext` ~6978/7003, `/settings` PUT ~718, `UserSettingsRequest`/`UserSettingsDto` ~7448-7499)
- Modify: `api/ArxTask.Api/WhatsAppDigest.cs`
- Test: `api/ArxTask.Api.Tests/WhatsAppSenderTests.cs`

**Interfaces:**
- Consumes: `WhatsAppSettingsRules.Apply`, `WhatsAppPhone.ToGraphRecipient`
- Produces:
  - `public sealed class WhatsAppMessageEntity : IOwnedEntity { string UserId; string Id; string Date /*yyyy-MM-dd*/; string Kind /*scheduled|test*/; string ToNumber; string Body; string Status /*sent|dry-run|failed*/; string? ProviderMessageId; string? Error; DateTimeOffset CreatedAt; }` — tablo `"WhatsAppMessages"`, PK `(UserId, Id)`; `db.WhatsAppMessages`.
  - `public sealed record WhatsAppSendResult(string Status, string? ProviderMessageId, string? Error);`
  - `public interface IWhatsAppSender { bool IsConfigured { get; } Task<WhatsAppSendResult> SendDigestAsync(string toE164, WhatsAppDigestContent content, CancellationToken ct = default); }`
  - `public sealed class WhatsAppCloudSender(IHttpClientFactory, IConfiguration) : IWhatsAppSender` + `public static string BuildTemplatePayload(string recipient, string templateName, string language, string nameParam, string listParam)`
  - `UserSettingsRequest` + `string? WhatsAppNumber, bool? WhatsAppDigestEnabled, string? WhatsAppDigestTime`; `UserSettingsDto` + `string WhatsAppNumber, bool WhatsAppDigestEnabled, string WhatsAppDigestTime`.

- [ ] **Step 1: Failing testleri yaz** (`WhatsAppSenderTests.cs`)

```csharp
[Fact] public void Payload_matches_graph_template_shape()
// BuildTemplatePayload("905321234567","planix_sabah_ozeti","tr","Mehmet","10:00 Montaj")
// JSON eşitliği: {"messaging_product":"whatsapp","to":"905321234567","type":"template",
//  "template":{"name":"planix_sabah_ozeti","language":{"code":"tr"},
//   "components":[{"type":"body","parameters":[{"type":"text","text":"Mehmet"},{"type":"text","text":"10:00 Montaj"}]}]}}
[Fact] public async Task Unconfigured_sender_returns_dry_run() // boş IConfiguration → IsConfigured false, Status "dry-run", HTTP çağrısı yok
[Fact] public async Task Graph_error_returns_failed_without_token_in_error()
// sahte HttpMessageHandler 400 {"error":{"message":"Invalid parameter"}} → Status "failed", Error "Invalid parameter" içerir, AccessToken metnini içermez
[Fact] public async Task Graph_success_returns_message_id() // 200 {"messages":[{"id":"wamid.X"}]} → Status "sent", ProviderMessageId "wamid.X"; istek URL'i "https://graph.facebook.com/v23.0/{PhoneNumberId}/messages", Bearer başlığı
```

- [ ] **Step 2: Çalıştır, kırmızı gör** — `dotnet test api/ArxTask.Api.Tests`

- [ ] **Step 3: Uygula**

Sender + entity `WhatsAppDigest.cs`'e. Program.cs: üç `EnsureColumn(connection, "Users", ...)` (`WhatsAppNumber TEXT NOT NULL DEFAULT ''`, `WhatsAppDigestEnabled INTEGER NOT NULL DEFAULT 0`, `WhatsAppDigestTime TEXT NOT NULL DEFAULT '08:00'`), `WhatsAppMessages` CREATE TABLE, `DbSet` + `HasKey`. `/settings` PUT: diğer alanlardan önce `var error = WhatsAppSettingsRules.Apply(user, request.WhatsAppNumber, request.WhatsAppDigestEnabled, request.WhatsAppDigestTime); if (error is not null) return Results.BadRequest(new { message = error });`. DI: `builder.Services.AddScoped<IWhatsAppSender, WhatsAppCloudSender>();`.

- [ ] **Step 4: Testler + derleme** — `dotnet test api/ArxTask.Api.Tests` PASS; `dotnet build api/ArxTask.Api` 0 hata.

- [ ] **Step 5: Commit** — `feat(api): WhatsApp ayarlari, mesaj kaydi ve Cloud API gondericisi`

---

### Task 3: Zamanlanmış gönderim servisi + test uç noktası

**Files:**
- Modify: `api/ArxTask.Api/WhatsAppDigest.cs`, `api/ArxTask.Api/Program.cs` (DI ~68, recurring job ~139, yeni endpoint `/settings` PUT'un ardına)
- Test: `api/ArxTask.Api.Tests/WhatsAppDigestServiceTests.cs`

**Interfaces:**
- Consumes: Task 1 composer/schedule, Task 2 `IWhatsAppSender`, `WhatsAppMessageEntity`
- Produces:
  - `public interface IWhatsAppDigestService { Task RunDueDigestsAsync(); Task<WhatsAppTestResult> SendTestAsync(string userId); }`
  - `public sealed record WhatsAppTestResult(string Preview, string Status /*sent|dry-run|failed|preview-only|no-number*/, string? Error);`
  - `public sealed class WhatsAppDigestService(ArxTaskDbContext db, IWhatsAppSender sender, TimeProvider clock) : IWhatsAppDigestService`
  - Endpoint `POST /settings/whatsapp/test` ([Authorize]) → `200 WhatsAppTestResult`
  - Hangfire recurring job `"whatsapp-digest"`, cron `Digest:WhatsAppCron ?? "*/5 * * * *"`, `TimeZone = AppTime.UserZone`

- [ ] **Step 1: Failing testleri yaz** — SQLite `:memory:` (açık bağlantı) + `EnsureCreated`, `FakeTimeProvider`, kaydedici sahte `IWhatsAppSender` (`IsConfigured` ayarlanabilir).

```csharp
[Fact] public async Task Sends_once_inside_window()           // 08:00 seçili, saat 08:05 → 1 gönderim; 08:10'da tekrar Run → hâlâ 1, kayıt Kind "scheduled" Status "sent"
[Fact] public async Task Skips_disabled_or_no_number()         // Enabled false ya da Number "" → gönderim yok, kayıt yok
[Fact] public async Task Skips_when_no_task_today()            // yalnızca gecikmiş görev → gönderim yok, kayıt yok
[Fact] public async Task Failed_blocks_rest_of_day()           // sender "failed" döner → 08:10'da tekrar denenmez
[Fact] public async Task Dry_run_logged_once_per_day()         // IsConfigured false → 08:05 ve 08:10 Run → tek "dry-run" kaydı, sender çağrılmaz
[Fact] public async Task Real_send_allowed_after_dry_run()     // 08:05 dry-run, 08:20'de IsConfigured true → "sent" kaydı oluşur
[Fact] public async Task Test_does_not_block_scheduled()       // 07:30 SendTestAsync (sent) → 08:05 Run yine gönderir
[Fact] public async Task Test_limit_three_per_day()            // 4. SendTestAsync → Status "preview-only", sender 3 kez çağrıldı
[Fact] public async Task Test_without_tasks_sends_empty_text() // görev yok → Preview "Günaydın …, bugün yapılacakların: Bugün planlanmış görevin yok."
[Fact] public async Task Test_without_number()                 // Number "" → Status "no-number", sender çağrılmaz
```

- [ ] **Step 2: Çalıştır, kırmızı gör** — `dotnet test api/ArxTask.Api.Tests`

- [ ] **Step 3: Uygula**

Servis görevleri `db.Tasks` + firma adları (`db.Companies`) ile `DigestTaskItem`'a çevirir; yerel saat `TimeZoneInfo.ConvertTime(clock.GetUtcNow(), AppTime.UserZone)`. Engelleme kuralı (spec "Günde bir kez kuralı"): o gün `scheduled` + `sent|failed` kaydı varsa atla; `scheduled` + `dry-run` kaydı varsa ve `sender.IsConfigured` false ise atla. Gönderim hatası tek kullanıcıyı etkiler, döngü devam eder. `Program.cs`: `builder.Services.AddSingleton(TimeProvider.System); builder.Services.AddScoped<IWhatsAppDigestService, WhatsAppDigestService>();`, recurring job, endpoint.

- [ ] **Step 4: Testler + derleme** — `dotnet test api/ArxTask.Api.Tests` PASS; `dotnet build api/ArxTask.Api` 0 hata.

- [ ] **Step 5: Yerel duman testi** — `dotnet run --project api/ArxTask.Api` (WhatsApp ayarı yok), giriş yapmış bir kullanıcının JWT'siyle `PUT /settings {"whatsAppNumber":"0532 123 45 67","whatsAppDigestEnabled":true}` → 200 ve `whatsAppNumber "+905321234567"`; `POST /settings/whatsapp/test` → `status "dry-run"`. Hangfire panelinde `whatsapp-digest` işi görünür.

- [ ] **Step 6: Commit** — `feat(api): WhatsApp sabah ozeti zamanlayicisi ve test mesaji`

---

### Task 4: Web ayar ekranı

**Files:**
- Modify: `types/business.ts` (`UserSettings`), `lib/api-client.ts` (~348), `lib/app-state.tsx` (~105, ~260), `components/pages/settings-page.tsx`, `locales/{tr,en,de,ar,fr,nl}.json`

**Interfaces:**
- Consumes: Task 2 `/settings` alanları, Task 3 `POST /settings/whatsapp/test`
- Produces: `UserSettings` + `whatsAppNumber: string; whatsAppDigestEnabled: boolean; whatsAppDigestTime: string;`; `export function sendWhatsAppTest(token: string): Promise<{ preview: string; status: string; error: string | null }>` (api-client); app-state'te `sendWhatsAppTest: () => Promise<…>`.

- [ ] **Step 1: Ayarlar sayfasına "WhatsApp sabah özeti" bölümü ekle** — numara metin alanı, aç/kapa, `<input type="time" step={900}>`, "Test mesajı gönder" butonu; sonuç (önizleme metni + durum: gönderildi / bağlantı yok, sadece kaydedildi / hata / günlük test sınırı) butonun altında gösterilir. Alanlar mevcut `save()` içindeki `updateSettings` çağrısına eklenir; API'nin 400 mesajı mevcut `errorMessage` ile gösterilir. Metinler `settings.whatsapp.*` anahtarlarıyla tüm locale dosyalarına (tr Türkçe; diğerleri İngilizce) eklenir.

- [ ] **Step 2: Doğrula** — `npm run typecheck` ve `npm run lint` hatasız.

- [ ] **Step 3: Commit** — `feat(web): WhatsApp sabah ozeti ayarlari`

---

### Task 5: Mobil ayar ekranı

**Files:**
- Modify: `ArX Task mobile/src/types/business.ts` (`AppSettings`), `ArX Task mobile/src/lib/api.ts` (~171), `ArX Task mobile/src/lib/app-data-context.tsx` (~106, ~414), `ArX Task mobile/app/(app)/settings.tsx`

**Interfaces:**
- Consumes: Task 2/3 API
- Produces: `AppSettings` + `whatsAppNumber: string; whatsAppDigestEnabled: boolean; whatsAppDigestTime: string;`; `export async function sendWhatsAppTest(token: string): Promise<{ preview: string; status: string; error: string | null }>`

- [ ] **Step 1: "Özet bildirimleri" kartının altına "WhatsApp sabah özeti" kartı ekle** — numara `TextInput` (`keyboardType="phone-pad"`) + Kaydet, `Switch`, saat için `−15 dk` / `+15 dk` düğmeli gösterge (yeni bağımlılık yok; 00:00–23:45 arasında döner), "Test mesajı gönder" butonu ve sonuç metni. Hatalar mevcut `Alert.alert("Kaydedilemedi", …)` deseniyle.

- [ ] **Step 2: Doğrula** — `cd "ArX Task mobile" && npm run typecheck && npm run test:logic` hatasız.

- [ ] **Step 3: Commit** — `feat(mobile): WhatsApp sabah ozeti ayarlari`

---

### Task 6: Kurulum belgesi, PR ve canlıya çıkış

**Files:**
- Create: `docs/whatsapp-kurulum.md`

- [ ] **Step 1: Belgeyi yaz** — Meta Business hesabı + numara + şablon başvurusu adımları; şablon adı `planix_sabah_ozeti`, dil `tr`, kategori "Utility", gövde: `Günaydın {{1}}, bugün yapılacakların: {{2}}`; Plesk .NET Core ortam değişkenleri (Global Constraints'teki adlar). Gizli değer yok.

- [ ] **Step 2: Tüm doğrulamalar** — `dotnet test api/ArxTask.Api.Tests`, `dotnet build api/ArxTask.Api`, `npm run typecheck`, `npm run lint`, mobil `npm run typecheck && npm run test:logic`.

- [ ] **Step 3: PR aç, kontroller yeşilse birleştir** (`gh pr create`, `gh pr merge --merge --delete-branch`).

- [ ] **Step 4: API'yi canlıya al** — yedek (`/root/arx-api-yedek-*.tar.gz` + db kopyası), `dotnet publish -c Release`, `appsettings*.json`/`web.config` hariç yükle, chown, `passenger-config restart-app`; ardından API'nin yanıt verdiğini ve yeni sürecin çalıştığını doğrula. Bağlantı: `ssh arx-sunucu`.
