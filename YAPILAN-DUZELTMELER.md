# ArX Task — Uygulanan Düzeltmeler

Denetim raporundaki ([ARX-TASK-DENETIM-RAPORU.md](ARX-TASK-DENETIM-RAPORU.md)) 4 şikayet ve ek bulgular P0→P1→P2 sırasıyla düzeltildi. **API `dotnet build` → 0 hata**, **mobil `tsc --noEmit` (strict) → 0 hata.** AI eşleştirme mantığı ayrı bir .NET test programıyla doğrulandı.

## P0 — En yüksek etki

### Şikayet #1 — AI firma/görev tanıma
- **Regex artık AI'ı ezmiyor** (`Program.cs` `NormalizeAiAnalysis`): Modelin firma kararı birincil; regex yalnızca model boş dönerse yedek. Güveni zorla 0.92'ye pinleme kaldırıldı. Aynı LLM-öncelik `CommitAiAnalysis` ve `BuildCompanyResolutionPrompt` çağrı noktalarına da uygulandı.
- **Diakritik-katlamalı + fuzzy firma eşleştirme** (`NormalizeCompanyFold`, `CompanyNameSimilarity`, `LevenshteinDistance`, `CompanyMatchTier`): İ/ı/I→i, ş→s, ğ→g, ç→c, ö→o, ü→u katlanıyor; token-set + Levenshtein benzerliği ≥0.85. Tam/diakritik eşleşme sessizce doğru firmaya bağlanır (duplicate yok), gerçek fuzzy eşleşme kullanıcıya sorulur.
  - Doğrulandı: "Ensar Döner"↔"Ensar Doner" ve "İpek Tekstil"↔"Ipek Tekstil" → **aynı firma**; "Mavi Tent"↔"Mavi Çadır" → **eşleşmez** (yanlış birleştirme yok).

### Şikayet #4 — Bildirim saati
- **Saat dilimi düzeltmesi** (`AppTime` yardımcı sınıfı + `ParseTaskDueAt` + `BuildAlertSchedule` + snooze): Görev saatleri artık `Europe/Istanbul` olarak yorumlanıp mutlak UTC instant'a çevriliyor — sunucu (Almanya) saati değil. Hatırlatmalar doğru anda tetiklenir.

## P1 — Belirgin eksikler

### Bildirim dayanıklılığı (#4 devamı)
- **Expo yanıt işleme** (`PushDispatcher.SendExpoPushBatch`): Ticket dizisi okunuyor; `DeviceNotRegistered` token'ları otomatik devre dışı bırakılıyor. Her iki gönderim noktası ortak yardımcıyı kullanıyor.
- **Cihaz-içi yerel bildirim yedeği** (`syncLocalTaskReminders`, `app-data-context`): Görevler değiştikçe OS düzeyinde yerel bildirim zamanlanıyor → sunucu/FCM/internet zinciri koparsa bile hatırlatma çalar.
- **iOS izni**: `ensureMobilePushRegistration` artık tüm platformlarda izin istiyor (yerel bildirimler iOS'ta da çalışır).
- **[BILDIRIM-KURULUM.md](BILDIRIM-KURULUM.md)**: FCM V1 / google-services kurulum rehberi (EAS'te manuel yapılması gerekenler).

### AI Asistan (#3)
- **Gerçek backend ucu** `POST /assistant/ask` (`AnswerAssistant`): Kullanıcının verisinden (görev/firma/teklif/fatura özeti) sunucuda context kurup gerçek OpenAI çağrısı yapıyor.
- **Mobil bağlandı** (`ai-assistant.tsx` + `askAssistant`): Gerçek AI yanıtı; internet yoksa/anahtar yoksa (503) offline anahtar-kelime özetine düşüyor. Yükleniyor durumu eklendi.

### Modül tutarlılığı & backend sağlamlaştırma (#3 + ek)
- **Ölçüm↔Döküman** (`isMeasurementDocument`, ortak yardımcı): Her iki ekran aynı substring eşleştirmesini kullanıyor — "Measurement photo" gibi etiketler artık Ölçüm merkezinde görünüyor.
- **Tüm görevler ekranı**: Modül **ID**'leri artık isim olarak gösteriliyor.
- **Teklif kabulü** (`AcceptOffer`): Kabul edilince "faturaya dönüştür/teslimat" takip görevi oluşturuluyor.
- **AI-capture null-guard** (`AnalyzeAndCommitCapture`): `SourceText` null'da artık 500 yerine 400.
- **Fatura idempotency** (`ConvertOfferToInvoice`): Zaten dönüştürülmüşse 409; fatura numarası saniye + id ekiyle benzersiz.
- **Toplam güvenliği** (`RecalculateOffer/Invoice`): Kalem toplamı Miktar×BirimFiyat ile yeniden hesaplanıyor.
- **SQLite dayanıklılığı**: WAL + `busy_timeout=5000` (PRAGMA) → "database is locked" azalır.
- **Güvenlik**: `SQLitePCLRaw.bundle_e_sqlite3` 2.1.12'ye yükseltildi (NU1903 yüksek önemli açık giderildi); Hangfire sürümleri 1.8.23'e hizalandı (NU1608 giderildi). **Uyarılar 8→2.**

## P2 — Frontend tasarım (#2)

Paylaşılan UI katmanından (`ui.tsx`, `task-card.tsx`) tüm ekranlara yayılan, kimliği (koyu + crimson) koruyan cilalama:
- **Derinlik**: Kart / StatTile / TaskCard / tab bar / ana buton artık gerçek gölge/elevation ile kanvastan kalkıyor. Signature: primary butonda crimson "ember glow".
- **Hero kart**: Crimson-tinted arka plan + aksan kenarlık → gerçek odak noktası (önceden varsayılandan ayırt edilemiyordu).
- **Hareket**: Kart, StatTile ve TaskCard mount'ta yaylı `FadeInDown` ile beliriyor (listeler canlanıyor).
- **Pull-to-refresh**: Panel, Bugün, Görevler, Firmalar, Teklifler, Faturalar ekranlarına eklendi.
- **Dokunsal geri bildirim**: Butonlarda basış scale + haptik (expo-haptics).
- Köşe yarıçapı 12→14, StatTile aksan kenarlık tini.

### P2 için önerilen (opsiyonel, sonraki adım)
- Markalı özel yazı tipi (`expo-font` + bir font dosyası/paketi gerekir).
- Gradyanlar (`expo-linear-gradient` paketi eklenirse hero/CTA'ya).

## Yeni özellik — Konum tabanlı görev hatırlatması (geofence)
- **`src/lib/geofencing.ts`**: OS-seviyesi geofencing (`expo-task-manager` + `expo-location`). O gün görevi olan ve koordinatı kayıtlı firmaların **1km** yarıçapına girilince, uygulama kapalı olsa bile arka plan görevi yerel bildirim çalar: *"X yakınındasınız — göreviniz vardı, yapmak ister misiniz?"* "Her yaklaşımda" tetiklenir (OS ENTER olayı).
- **İlk açılışta izin** (`app/(app)/_layout.tsx`): bildirim + konum (ön plan + arka plan "her zaman") izni istenir.
- **Otomatik senkron** (`app-data-context`): bugünkü görev firmaları değiştikçe geofence'ler güncellenir (en yakın ~20, OS limiti).
- **`app.json`**: `ACCESS_BACKGROUND_LOCATION` izni, expo-location arka plan konfigürasyonu, iOS açıklama metni.
- Kısıt: yalnızca standalone APK'da çalışır (Expo Go değil); Android'de kullanıcı "Her zaman izin ver" seçmelidir.

## FCM entegrasyonu (uzak push)
- `google-services.json` projeye ve `android/app/`'e eklendi (`app.json` → `googleServicesFile`). Paket `com.arxtask.mobile` eşleşiyor. `prebuild` ile Google Services Gradle plugin uygulandı → Android uzak push (Expo→FCM) teslimi aktif.

## APK build
- Yeni native config için `expo prebuild -p android` çalıştırıldı; standalone release APK derlendi (debug keystore ile imzalı, JS gömülü — Metro'suz çalışır). Kurulum: telefonda "bilinmeyen kaynaklara izin ver" → APK'ye dokun.

## Kalan küçük/opsiyonel maddeler
- Döküman gerçek dosya yükleme/OCR (depolama backend'i gerektirir — ayrı özellik).
- `Program.cs`'te 4 kullanılmayan "Legacy" fonksiyon (CS8321 uyarısı; işlevsel etki yok).
- Firma detayı teklif/fatura sekmelerine aksiyon ekleme.
- Koordinatı olmayan firmalar için adresten otomatik koordinat (geocode) — geofence kapsamını artırır.
