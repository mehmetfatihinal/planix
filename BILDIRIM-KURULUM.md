# Bildirim Kurulumu (FCM / Expo Push)

Bu proje **standalone Android** derlemesinde uzak bildirim (Expo push) için **FCM V1** kimlik bilgisi gerektirir. Kod tarafı hazır; aşağıdaki manuel adımlar EAS/Firebase panelinde yapılmalıdır. Yapılmazsa cihaz push token'ı üretir ama Expo, FCM adımında teslim edemez → **bildirim sessizce gitmez**.

> Not: Kod tarafında ayrıca bir **cihaz-içi yerel bildirim yedeği** eklendi (`syncLocalTaskReminders`). Bu, FCM olmadan bile görev hatırlatmalarının cihazda çalmasını garanti eder. FCM kurulumu, uygulama uzun süre kapalıyken/başka cihazdan oluşturulan görevler için uzak push'u da devreye alır.

## 1. Firebase projesi + FCM V1
1. https://console.firebase.google.com → yeni proje (veya mevcut).
2. Android uygulaması ekle, paket adı **`com.arxtask.mobile`** (app.json ile birebir aynı olmalı).
3. `google-services.json` dosyasını indir.
4. Proje ayarları → Cloud Messaging → **Firebase Cloud Messaging API (V1)** etkin olmalı.
5. Service Account → "Generate new private key" ile **service account JSON**'unu indir (Expo bunu FCM V1 için kullanır).

## 2. app.json'a google-services bağla
`android` bölümüne ekle:
```json
"android": {
  "package": "com.arxtask.mobile",
  "googleServicesFile": "./google-services.json",
  ...
}
```
`google-services.json` dosyasını repo köküne (mobil klasörüne) koy. (Gizli bilgi içerdiğinden `.gitignore`'a eklemeyi ve EAS secret olarak yönetmeyi değerlendir.)

## 3. Expo'ya FCM V1 kimlik bilgisini yükle
```bash
cd "ArX Task mobile"
eas credentials
# Platform: Android → Push Notifications: FCM V1 → service account JSON'unu yükle
```
veya EAS panelinden Project → Credentials → Android → FCM V1.

## 4. (Opsiyonel ama önerilir) Expo Access Token
Sunucu tarafı `Expo:AccessToken` yapılandırılırsa push güvenliği artar (zorunlu değil):
- expo.dev → Account → Access Tokens → token üret.
- Sunucuda ortam değişkeni: `Expo__AccessToken=<token>` (Plesk'te çift alt çizgi).

## 5. Doğrulama
- Yeni bir development/production build al (`eas build -p android`). Expo Go'da uzak push **çalışmaz**; standalone build gerekir.
- Uygulamada Ayarlar → "Bildirimleri etkinleştir" → izin ver.
- Sunucuda bir görev oluşturup yakın bir saate hatırlatma kur; hem yerel yedek hem (FCM kuruluysa) uzak push gelmelidir.
- Sunucu logunda Expo yanıtı artık işleniyor: geçersiz token'lar (`DeviceNotRegistered`) otomatik devre dışı bırakılıyor.

## iOS notu
iOS uzak push için APNs kimlik bilgisi (Apple Developer hesabı) gerekir ve `eas credentials` ile ayrı yapılandırılır. Kod artık iOS'ta da bildirim **iznini istiyor**, böylece cihaz-içi yerel hatırlatmalar iOS'ta da çalışır; uzak push için APNs kurulumu ayrıca yapılmalıdır.
