# planix (ArX Task)

Saha satış / görev / CRM uygulaması. Üç parça:

- Web: Next.js, kök klasör (`app/`, `components/`, `lib/`, `locales/`). Canlı adres
  `megaajans.de` (Plesk Node.js, Passenger; sunucuda `/var/www/vhosts/megaajans.de/httpdocs/app`).
- API: .NET 10, `api/ArxTask.Api` (SQLite + Hangfire). Canlı adres `api.megaajans.de`
  (Plesk .NET, Passenger; `/var/www/vhosts/api.megaajans.de/httpdocs`). Testler `api/ArxTask.Api.Tests`.
- Mobil: Expo, `ArX Task mobile/`. APK elle derlenir, otomatik deploy'a girmez.

Sunucu Plesk VPS `87.106.47.17`. Repo `mehmetfatihinal/planix` ve herkese açık (public):
gizli bilgi hiçbir dosyaya yazılmaz.

## Ekip çalışma düzeni

Projede birden çok kişi çalışıyor. Kod `main`'e yalnız PR ile girer; testler yeşilse PR'ı
Claude kendisi birleştirir; `main`'e giren kod otomatik olarak canlıya çıkar. Sunucuda dosya
DÜZENLENMEZ.

### Kullanıcı ne derse ne yap

| Kullanıcı | Sen |
|---|---|
| "Yeni iş: X" / bir iş tarif ediyor | `git fetch` → `origin/main`'den `<isim>/<kisa-is-adi>` dalı aç (isim: `git config user.name`'in ilk kelimesi, küçük harf, Türkçe karaktersiz). Sonra işe başla. |
| "Bitti" / "PR aç" / "canlıya al" | Testleri çalıştır, dalı push et, `gh pr create` ile PR aç (başlık ve açıklama Türkçe: ne değişti, nasıl denendi). Sonra PR'ı KENDİN birleştir, kullanıcı onayı bekleme (ekip kararı, 2026-10-17): "Doğrulama" çalışmasını bekle (`gh run list -w Doğrulama -b <dal> -L 1` → `gh run watch <id> --exit-status`; başka kontrolleri yok say), yeşilse `gh pr merge --merge --delete-branch`. Ardından "Canlıya çıkar" çalışmasını izle (`gh run watch`) ve canlı adresin açıldığını kontrol et; sonucu kullanıcıya kısaca bildir. Test kırmızıysa BİRLEŞTİRME: hatayı düzelt, tekrar dene. `gh` yoksa PR linkini ver; birleştirmeyi kullanıcı yapar. |
| "X'in işinden devam et" | `git fetch` → ilgili dalı bul (`git branch -r`), o dala geç, son commit'leri özetle, devam et. |
| "Güncel hali çek" | Kendi dalındaysan: `git pull --rebase` ve `git rebase origin/main` (çakışma varsa çöz, özetle). `main`'deysen: `git pull`. |
| "Deploy et" | Doğrudan sunucuya deploy YOK: "Bitti" satırını uygula. Birleşince GitHub Actions canlıya çıkarır. Kod değişmeden yeniden çıkarmak gerekirse: `gh workflow run deploy.yml -R mehmetfatihinal/planix -f hedef=ikisi` (ya da `api` / `web`). |
| "Geri al" | Aşağıdaki "Geri alma" bölümü. Önce kullanıcıya neyin geri alınacağını söyle ve onay al. |
| "APK derle" | Mobil elle derlenir (`ArX Task mobile/`); bu düzenin dışında. |

### Kurallar

- Testler kırmızıyken PR asla birleştirilmez. Birleştirdiğin her şey birkaç dakika içinde
  canlıda olur; birleştirmeden önce PR'ın gerçekten bitmiş iş olduğundan emin ol.
- `main` üzerinde dosya düzenleme. Kullanıcı `main`'deyken iş isterse önce dal aç.
- Her cevabın sonunda `.claude/hooks/oto-push.sh` değişiklikleri kendiliğinden commit edip
  kişinin dalına push eder. Ayrıca commit/push istemene gerek yok; ama anlamlı bir adım
  bittiğinde açıklayıcı mesajla kendin commit etmen iyi olur.
- Oto-push "push reddedildi" derse: `git pull --rebase origin <dal>`, çakışmayı çöz,
  kullanıcıya ne birleştiğini özetle.
- Gizli bilgi (`appsettings.Production.json`, anahtar, token) asla commit edilmez. Repo açık:
  bir kez push edilen sır herkese görünür, hemen değiştirilmesi gerekir.
- Başkasının dalına onun haberi olmadan force-push yapma.

### Sunucu erişimi

`ssh arx-sunucu` (kısayol `~/.ssh/config`'te; anahtar `~/.ssh/tvds_deploy`, root). Başka anahtar
arama; anahtar ve `~/.ssh` içeriği okunmaz, gösterilmez. Kod sunucuya SSH ile elle gitmez;
SSH yalnız log, yedek ve geri alma için.

### Deploy nasıl işliyor

1. PR açılınca `.github/workflows/ci.yml` ("Doğrulama") çalışır: web'de tip kontrolü,
   `npm run test:logic`, `npm run build`; API'de `dotnet test`.
2. `main`'e birleşince `.github/workflows/deploy.yml` ("Canlıya çıkar") neyin değiştiğine
   bakar ve yalnız değişen tarafı GitHub'da derleyip paket olarak sunucuya gönderir
   (ikisi de değiştiyse önce API). Testleri tekrar koşmaz.
3. Sunucuda paketi `/usr/local/bin/planix-kapi` kurar (repodaki kopyası
   `ops/deploy/planix-kapi.sh`). Deploy anahtarı (`PLANIX_SSH_KEY`) yalnız bu kapıya açılır.
   Repo açık olduğu için kurulum mantığı repodan okunmaz: kapı dosyası değişirse sunucuya elle
   kurulur (dosyanın başında komutu var).
   - API: önce veritabanının kopyası (`/var/backups/planix/db/`, son 10), çalışan sürümün kopyası
     (`/var/backups/planix/api-onceki/`), sonra dosyalar. `appsettings*.json`, `web.config` ve
     `*.db` dosyalarına dokunulmaz.
   - Web: yeni sürüm yan klasörde hazırlanır, klasörler yer değiştirir (`app` ↔ `app.onceki`).
     `package-lock.json` değişmediyse `node_modules` gönderilmez, canlıdaki kullanılır.
   - Sağlık kontrolü (`https://api.megaajans.de/`, `https://megaajans.de/` ve `/login` 200 dönmeli)
     geçmezse önceki sürüme kendiliğinden dönülür.
4. İş akışı yalnız repo değişkeni `DEPLOY_ACIK=true` iken çalışır. Kayıt:
   `/var/log/planix-deploy.log`, çıkan sürümler `/var/backups/planix/gecmis`.

### Veritabanı

API açılışta eksik tabloları/sütunları kendisi ekler (`EnsureCreated` + `ALTER TABLE ADD COLUMN`).
Sütun silme, veri taşıma gibi işler deploy ile otomatik yapılmaz: PR açıklamasına ne yapılacağını
yaz, sunucuda uygulamadan önce kullanıcıdan onay al. Kod geri alınabilir, silinen veri geri gelmez.

### Geri alma

- Web (bir önceki sürüm, anlık):
  `ssh arx-sunucu 'cd /var/www/vhosts/megaajans.de/httpdocs && mv app app.geri && mv app.onceki app && mv app.geri app.onceki && touch app/tmp/restart.txt'`
- API (bir önceki sürüm):
  `ssh arx-sunucu 'rsync -a /var/backups/planix/api-onceki/ /var/www/vhosts/api.megaajans.de/httpdocs/ && chown -R "$(stat -c %U:%G /var/www/vhosts/api.megaajans.de/httpdocs)" /var/www/vhosts/api.megaajans.de/httpdocs && touch /var/www/vhosts/api.megaajans.de/httpdocs/tmp/restart.txt'`
- Daha eski bir sürüm: `main`'de hatalı commit'i geri alan (`git revert`) bir PR aç; birleşince
  normal deploy ile çıkar.

### GitHub Actions

Repo herkese açık olduğu için işler GitHub'ın makinelerinde (`ubuntu-latest`) koşar; açık
repolarda Actions dakikası ücretsiz. Kendi sunucumuzdaki runner (`arx-sunucu`) bu repoya
KAYDEDİLMEZ: dışarıdan gelen bir PR sunucuda kod çalıştırabilir. Repo ileride gizliye
(private) çevrilirse runner'a geçilebilir (bkz. `ArifAkdag49/arx-menu-panel` → `ops/runner/`).
Taslak (draft) PR'da "Doğrulama" atlanır; Claude PR'ları taslak açmaz.
