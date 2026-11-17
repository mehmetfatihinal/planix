#!/usr/bin/env bash
# Planix deploy anahtarının sunucudaki TEK kapısı. GitHub Actions ("Canlıya çıkar",
# .github/workflows/deploy.yml) GitHub'da derlediği paketi buraya gönderir.
#
# GitHub'daki PLANIX_SSH_KEY sırrının açık anahtarı /root/.ssh/authorized_keys'e
# tek satır olarak şöyle yazılır:
#
#   restrict,command="/usr/local/bin/planix-kapi" ssh-ed25519 AAAA... planix-deploy
#
# ve bu dosya /usr/local/bin/planix-kapi olarak kurulur (root, 755). Anahtar sızsa
# bile kabuk açamaz, dosya okuyamaz, başka siteye ulaşamaz. Yalnız şunları yapabilir:
#
#   kilit <sha256>   canlı web'in package-lock.json'u bununla aynı mı? → "ayni" | "farkli"
#                    (aynıysa Actions node_modules göndermez, canlıdaki kullanılır)
#   api <commit>     stdin'deki .tar.gz'yi (dotnet publish çıktısı) api.megaajans.de'ye kur
#   web <commit>     stdin'deki .tar.gz'yi (next build çıktısı) megaajans.de'ye kur
#
# Repo herkese açık olduğu için kurulum mantığı repodan okunmaz, bu dosyanın
# içinde durur. Repodaki kopya değişirse sunucuya ELLE kurulmalı:
#   scp ops/deploy/planix-kapi.sh arx-sunucu:/usr/local/bin/planix-kapi
#   ssh arx-sunucu "chmod 755 /usr/local/bin/planix-kapi"
#
# Kalıcı veri (SQLite veritabanları, appsettings*.json, web.config, .env.production)
# paketle gelmez, üzerine yazılmaz. API'den önce veritabanının kopyası alınır
# (API açılışta tabloya sütun ekleyebiliyor). Sağlık kontrolü geçmezse önceki sürüme
# kendiliğinden dönülür.
set -euo pipefail

API=/var/www/vhosts/api.megaajans.de/httpdocs
WEB=/var/www/vhosts/megaajans.de/httpdocs/app
YEDEK=/var/backups/planix
GECICI=/var/tmp/planix-deploy
LOG=/var/log/planix-deploy.log
EN_BUYUK=1500M   # paket sınırı (diski doldurmasın)

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG" >&2; }

# Passenger (nginx) altında çalışan uygulamayı yeniden başlat.
yeniden_baslat() {
  local ornek
  ornek=$(passenger-config list-instances 2>/dev/null | awk '/nginx/{print $1; exit}')
  passenger-config restart-app "$1" ${ornek:+--instance "$ornek"} >/dev/null 2>&1 \
    || touch "$1/tmp/restart.txt"
}

# $1 adres: 40 × 3 sn içinde 200 dönmeli
saglikli() {
  local i
  for i in $(seq 1 40); do
    [ "$(curl -sL -o /dev/null -w '%{http_code}' --max-time 10 "$1")" = 200 ] && return 0
    sleep 3
  done
  return 1
}

paketi_al() { # $1 tür, $2 commit → paketin açıldığı klasör (stdout)
  local dosya="$GECICI/$1-$2.tgz" klasor="$GECICI/$1-$2"
  rm -rf "$klasor" "$dosya"
  mkdir -p "$klasor"
  head -c "$EN_BUYUK" > "$dosya"
  gzip -t "$dosya" 2>/dev/null || { rm -f "$dosya"; log "DUR: paket bozuk ya da $EN_BUYUK sınırını aştı"; exit 1; }
  tar -xzf "$dosya" -C "$klasor" --no-same-owner
  rm -f "$dosya"
  echo "$klasor"
}

api_kur() {
  local sha=$1 yeni sahip onceki_pid
  yeni=$(paketi_al api "$sha")
  [ -f "$yeni/ArxTask.Api.dll" ] || { log "DUR: pakette ArxTask.Api.dll yok"; exit 1; }
  sahip=$(stat -c '%U:%G' "$API")

  log "api ${sha:0:10}: veritabanı yedekleniyor"
  mkdir -p "$YEDEK/db"
  sqlite3 "$API/arx-task.db" ".backup '$YEDEK/db/arx-task-$(date +%Y%m%d-%H%M%S)-${sha:0:10}.db'"
  ls -1t "$YEDEK"/db/arx-task-*.db | tail -n +11 | xargs -r rm -f   # son 10 kopya

  # Çalışan sürümün kopyası (geri dönüş için). Kalıcı veri ve eski elle-yükleme artıkları hariç.
  local haric=(--exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' --exclude='*.db.yedek-*'
    --exclude='appsettings*.json' --exclude='web.config' --exclude='logs/' --exclude='tmp/'
    --exclude='*.tar.gz' --exclude='*.zip' --exclude='arx-task-api-publish-*/' --exclude='plesk-*/'
    --exclude='publish-plesk*/' --exclude='temp-build/' --exclude='temp-deploy/')
  mkdir -p "$YEDEK/api-onceki"
  rsync -a --delete "${haric[@]}" "$API/" "$YEDEK/api-onceki/"

  log "api ${sha:0:10}: dosyalar kuruluyor"
  rsync -a "${haric[@]}" "$yeni/" "$API/"
  chown -R "$sahip" "$API"
  rm -rf "$yeni"

  onceki_pid=$(pgrep -n -f "$API/ArxTask.Api.dll" | head -1 || true)
  yeniden_baslat "$API"
  if saglikli https://api.megaajans.de/ && [ "$(pgrep -n -f "$API/ArxTask.Api.dll" | head -1 || true)" != "$onceki_pid" ]; then
    echo "$(date -Is) api $sha" >> "$YEDEK/gecmis"
    log "api ${sha:0:10}: tamam, canlıda"
    return 0
  fi

  log "api ${sha:0:10}: SAĞLIK KONTROLÜ GEÇMEDİ — önceki sürüme dönülüyor"
  rsync -a "${haric[@]}" "$YEDEK/api-onceki/" "$API/"
  chown -R "$sahip" "$API"
  yeniden_baslat "$API"
  if saglikli https://api.megaajans.de/; then log "önceki API sürümü ayakta"; else log "UYARI: önceki API sürümü de yanıt vermiyor — elle bakılmalı"; fi
  exit 1
}

web_kur() {
  local sha=$1 yeni sahip f
  yeni=$(paketi_al web "$sha")
  [ -d "$yeni/.next" ] && [ -f "$yeni/server.js" ] || { log "DUR: pakette .next ya da server.js yok"; exit 1; }
  sahip=$(stat -c '%U:%G' "$WEB/package.json")

  if [ ! -d "$yeni/node_modules" ]; then
    # package-lock aynı: canlıdaki node_modules'u sabit bağla (kopyalamadan, anlık)
    cp -al "$WEB/node_modules" "$yeni/node_modules"
  fi
  for f in .env.production .node-version; do   # sunucuya özel ayarlar korunur
    [ -f "$WEB/$f" ] && cp -p "$WEB/$f" "$yeni/$f"
  done
  mkdir -p "$yeni/tmp"
  chown -R "$sahip" "$yeni"

  log "web ${sha:0:10}: yeni sürüme geçiliyor"
  rm -rf "$WEB.onceki"
  mv "$WEB" "$WEB.onceki"
  mv "$yeni" "$WEB"
  yeniden_baslat "$WEB"
  if saglikli https://megaajans.de/ && saglikli https://megaajans.de/login; then
    echo "$(date -Is) web $sha" >> "$YEDEK/gecmis"
    log "web ${sha:0:10}: tamam, canlıda"
    return 0
  fi

  log "web ${sha:0:10}: SAĞLIK KONTROLÜ GEÇMEDİ — önceki sürüme dönülüyor"
  rm -rf "$WEB.bozuk"
  mv "$WEB" "$WEB.bozuk"
  mv "$WEB.onceki" "$WEB"
  yeniden_baslat "$WEB"
  if saglikli https://megaajans.de/; then log "önceki web sürümü ayakta (bozuk sürüm: $WEB.bozuk)"; else log "UYARI: önceki web sürümü de yanıt vermiyor — elle bakılmalı"; fi
  exit 1
}

istek="${SSH_ORIGINAL_COMMAND:-}"
mkdir -p "$GECICI" "$YEDEK"
chmod 700 "$GECICI" "$YEDEK"

case "$istek" in
  "kilit "*)
    h="${istek#kilit }"
    [[ "$h" =~ ^[0-9a-f]{64}$ ]] || { echo "geçersiz özet" >&2; exit 1; }
    if [ -d "$WEB/node_modules" ] && [ "$(sha256sum "$WEB/package-lock.json" 2>/dev/null | cut -d' ' -f1)" = "$h" ]; then
      echo ayni
    else
      echo farkli
    fi
    ;;
  "api "* | "web "*)
    tur="${istek%% *}"
    sha="${istek#* }"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "geçersiz commit: $sha" >&2; exit 1; }
    exec 9>/run/planix-deploy.lock
    flock -w 900 9 || { log "DUR: başka bir deploy sürüyor"; exit 1; }
    "${tur}_kur" "$sha"
    ;;
  *)
    echo "izin yok: ${istek:-<boş>}" >&2
    exit 1
    ;;
esac
