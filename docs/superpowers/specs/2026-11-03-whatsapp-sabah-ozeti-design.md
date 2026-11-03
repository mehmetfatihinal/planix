# WhatsApp sabah özeti — tasarım

Tarih: 2026-11-03 · Durum: taslak (onay bekliyor)

## Amaç ve neden

Planix'in kendi WhatsApp hattı olsun. Her kullanıcıya, hesabına bağlı WhatsApp
numarasından, **kendi seçtiği saatte** o güne ait yapılacakları listeleyen tek bir
mesaj gitsin:

> Günaydın Mehmet, bugün yapılacakların: 10:00 Montaja git (Ensar Döner) • 14:00 Teklif gönder (Mara Market) • Süt al

Kullanıcı uygulamayı açmadan gününü WhatsApp'tan görsün.

## Kapsam

**Bu iş (şimdi):** Altyapı ve kod tarafının tamamı.
**Sonra (kullanıcı halledecek):** Meta Business hesabı, WhatsApp numarası, onaylı mesaj
şablonu ve erişim anahtarının sunucuya girilmesi. Bunlar gelene kadar sistem gerçek
mesaj göndermez, "gönderilecekti" diye kayıt tutar (aşağıda "Bağlantı yokken").

### Hedefler
- Kullanıcı ayarlarında: **WhatsApp numaram**, **Sabah WhatsApp özeti (aç/kapat)**,
  **Gönderim saati** (kullanıcı seçer).
- Web (`components/pages/settings-page.tsx`) ve mobil (`ArX Task mobile/app/(app)/settings.tsx`)
  ayar ekranlarının ikisinde de bu alanlar olsun.
- Her kullanıcıya günde **en fazla bir** sabah özeti gitsin.
- "Test mesajı gönder": kullanıcı bugünkü mesajın metnini görsün (bağlantı varsa
  gerçekten gönderilsin).
- Meta ayarları girildiği gün kod değişikliği gerekmeden gerçek gönderim başlasın.

### Hedef dışı (bu işte yok)
- WhatsApp'tan gelen cevapları işlemek ("tamam", "ertele" vb.). Webhook yok.
- Gün içinde ayrı ayrı görev hatırlatmaları (mevcut push hatırlatmaları kalıyor).
- Numara doğrulama (OTP) akışı.
- Birden fazla dil; mesajlar şimdilik Türkçe.

### Başarısızlık sayılacaklar (çalışsa bile)
- Aynı kullanıcıya aynı gün iki sabah özeti gitmesi.
- Kullanıcının seçmediği bir saatte (örn. gece yarısı, sunucu yeniden başlayınca) mesaj gitmesi.
- Meta ayarları boşken uygulamanın hata vermesi ya da başka bir özelliğin bozulması.
- Erişim anahtarının repoya ya da loglara yazılması.

## Mevcut yapı (üzerine kurulacak)
- `AppUser` (`api/ArxTask.Api/Program.cs`): `DailyDigestEnabled`, `WeeklyDigestEnabled`
  gibi ayar alanları var; yeni kolonlar `EnsureColumn(connection, "Users", ...)` ile eklenir
  (SQLite, migration yok).
- Ayarlar: API'deki kullanıcı ayarları isteği (`request.DailyDigestEnabled is not null ...`
  kalıbı) ve settings yanıtı; web ve mobil tipler `types/business.ts`,
  `ArX Task mobile/src/types/business.ts`.
- Zamanlayıcı: Hangfire. `daily-digest` / `weekly-digest` recurring job'ları
  `AppTime.UserZone` (Türkiye saati) ile çalışıyor. `DigestService` deseni örnek alınır.
- Görev tarih/saati: `BusinessTaskEntity.DueDate` (`yyyy-MM-dd`) ve `DueTime` (`HH:mm`);
  durum için `TaskLogic.GetEffectiveTaskStatus`.

## Kararlaştırılanlar

### Kullanıcı tarafı
- Kullanıcı kendi gönderim saatini seçer (kullanıcının kararı).
- Varsayılan: özet **kapalı**, saat **08:00**. Açmak için numara girilmiş olmalı.
- Numara uluslararası biçimde saklanır (`+905xx...`). Kullanıcı `05xx...` yazarsa Türkiye
  numarası varsayılıp `+90`'a çevrilir; geçersizse kaydetme hata döner.

### Mesaj içeriği
- "Günaydın {isim}, bugün yapılacakların:" + o günün açık görevleri.
- Bugünün görevi = `DueDate` bugün olan, durumu `done` olmayan görev — saati gönderim
  anında geçmiş olsa bile listede kalır (`TaskLogic` "overdue" saysa da). *(Claude'un kararı)*
- Gecikmiş sayısı = `DueDate` bugünden **önce** olan, `done` olmayan görevler (saati olsun
  olmasın). `TaskLogic` durumu bu sayımda kullanılmaz. *(Claude'un kararı)*
- Alışkanlıklar (`IsHabit`) ve onay bekleyen görevler (`pending_approval`) ne listeye ne
  gecikmiş sayısına girer. *(Claude'un kararı)*
- Sıralama: saati olanlar saate göre, saatsizler en sonda.
- Her satır: `HH:mm Başlık (Firma adı)` — saat ve firma yoksa atlanır.
- Gecikmiş açık görev varsa sonuna: "Ayrıca N gecikmiş işin var."
- Bugün görevi yoksa (gecikmiş olsa bile) **mesaj gitmez**.
- En fazla 15 görev listelenir; fazlası "+N görev daha" olarak eklenir.

### Bağlantı (Meta WhatsApp Cloud API)
- Gönderim Meta'nın resmi WhatsApp Cloud API'si ile, **onaylı şablon mesajı** olarak
  (işletmenin başlattığı mesajlar için zorunlu).
- Sunucu ayarları (Plesk ortam değişkeni, repoya girmez):
  `WhatsApp__AccessToken`, `WhatsApp__PhoneNumberId`, `WhatsApp__TemplateName`,
  `WhatsApp__TemplateLanguage` (varsayılan `tr`).
- Şablon iki değişken alır: `{{1}}` = isim, `{{2}}` = görev listesi.
  Meta şablon değişkenlerinde satır sonuna izin vermediği için liste tek satırda
  ` • ` ile ayrılır. Önerilen şablon metni belgeye/README'ye eklenir ki Meta'ya
  başvururken kopyalanabilsin.

### Bağlantı yokken
- `AccessToken` veya `PhoneNumberId` boşsa gönderim yapılmaz; mesaj **"dry-run"** olarak
  kaydedilir (kime, hangi metin, ne zaman) ve loglanır. Diğer her şey normal çalışır.

### Gönderim kaydı
- Her gönderim denemesi kaydedilir: kullanıcı, tarih, tür (`scheduled` / `test`), numara,
  metin, durum (`sent` / `dry-run` / `failed`), Meta mesaj kimliği veya hata. Bu kayıt
  "günde bir kez" kuralının da dayanağıdır.
- Günde bir kez kuralı *(Claude'un kararı)*: o gün için `scheduled` türünde `sent` veya
  `failed` kaydı varsa o gün tekrar denenmez (zaman aşımında Meta mesajı iletmiş olabilir;
  çift mesaj riskine girilmez). `dry-run` kaydı günü **tüketmez**, ama gönderim yine yalnızca
  kullanıcının saatinden sonraki kısa telafi aralığında yapılır.

### Test mesajı *(Claude'un kararları)*
- Kayıtlı numarası olan herkes kullanabilir; sabah özeti kapalı olsa da çalışır.
- Kaydı `test` türündedir ve o günün planlı (`scheduled`) gönderimini engellemez.
- Bugün görevi yoksa önizlemede "Bugün planlanmış görevin yok" metni gösterilir/gönderilir.
- Kullanıcı başına günde en fazla 3 gerçek test gönderimi (her mesaj ücretli);
  sınır aşılınca yalnızca önizleme döner.

## Builder'a bırakılanlar
- Zamanlayıcının çalışma sıklığı ve "saati geldi mi" mantığı (kaçırılan gönderimler
  için tolerans dahil — "başarısızlık" bölümündeki kurallara uymak şartıyla).
- Saat seçiminin adımı (ör. 15 dk) ve ekrandaki bileşen.
- Kayıt tablosunun adı/alanları, servis/sınıf adları.
- Test mesajı uç noktasının tam şekli.
