# WhatsApp sabah özeti — bağlantı kurulumu

Kod tarafı hazır. Meta bağlantısı kurulana kadar sistem gerçek mesaj göndermez; her
gönderimi `WhatsAppMessages` tablosuna `dry-run` olarak yazar. Aşağıdaki adımlar
tamamlanınca kod değişikliği gerekmeden gerçek gönderim başlar.

## 1. Meta tarafı

1. [business.facebook.com](https://business.facebook.com) üzerinden bir **Meta Business hesabı**
   aç ve işletmeyi doğrula (Business Verification).
2. [developers.facebook.com](https://developers.facebook.com) → **Uygulama oluştur** → tür
   "Business" → ürün olarak **WhatsApp** ekle.
3. WhatsApp → **API Setup**: daha önce WhatsApp'a (normal ya da Business uygulamasına)
   bağlanmamış bir telefon numarası ekle ve SMS/arama ile doğrula.
   Bu sayfadaki **Phone number ID** değerini not al.
4. Kalıcı erişim anahtarı: Business Settings → **System users** → yeni sistem kullanıcısı
   (Admin) → uygulamayı ve WhatsApp hesabını ata → **Generate token** →
   izinler: `whatsapp_business_messaging`, `whatsapp_business_management`.
   Bu anahtar gizlidir; repoya, sohbete ya da e-postaya yazma.
5. WhatsApp Manager → **Message templates** → yeni şablon:
   - Ad: `planix_sabah_ozeti`
   - Kategori: **Utility**
   - Dil: **Turkish (tr)**
   - Gövde (Body):

     ```
     Günaydın {{1}}, bugün yapılacakların: {{2}}
     ```

   - Örnek değerler: `{{1}}` = `Mehmet`, `{{2}}` = `10:00 Montaja git (Ensar Döner) • 14:00 Teklif gönder (Mara Market)`

   Şablonun **Approved** olmasını bekle (genelde birkaç dakika – bir gün).

## 2. Sunucu tarafı (Plesk)

Plesk → Web Siteleri ve Alan Adları → `api.megaajans.de` → **.NET Core** →
ortam değişkenleri (Edit environment variables) → şunları ekle ve **Save**:

| Ad | Değer |
|---|---|
| `WhatsApp__AccessToken` | 1.4'teki kalıcı anahtar |
| `WhatsApp__PhoneNumberId` | 1.3'teki Phone number ID |
| `WhatsApp__TemplateName` | `planix_sabah_ozeti` (farklı adla açtıysan o ad) |
| `WhatsApp__TemplateLanguage` | `tr` (isteğe bağlı, varsayılan `tr`) |
| `WhatsApp__ApiVersion` | isteğe bağlı, varsayılan `v23.0` |

İsteğe bağlı: zamanlayıcı sıklığı `Digest__WhatsAppCron` (varsayılan `*/5 * * * *`).

## 3. Deneme

1. Uygulamada **Ayarlar → WhatsApp sabah özeti**: numaranı gir, kaydet.
2. **Test mesajı gönder**: durum "gönderildi" olmalı ve mesaj WhatsApp'a gelmeli.
   "Bağlantı henüz kurulmadı" görürsen 2. adımdaki değişkenler eksik ya da uygulama
   yeniden başlamamış demektir.
3. Hata varsa son kayıtlar: sunucuda `WhatsAppMessages` tablosundaki `Status`/`Error` alanları.

## Davranış özeti

- Her kullanıcı kendi saatini seçer; mesaj o saatten sonraki 60 dakika içinde gider
  (sunucu bu aralıkta kapalıysa o gün atlanır).
- Günde en fazla bir sabah özeti; başarısız gönderim o gün tekrar denenmez.
- Bugün görevi olmayan kullanıcıya mesaj gitmez.
- Test mesajları planlı özeti engellemez; kullanıcı başına günde en fazla 3 test (bağlantı yokken de).
