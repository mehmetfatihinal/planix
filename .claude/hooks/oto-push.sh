#!/usr/bin/env bash
# Claude her cevabını bitirdiğinde çalışır (Stop hook'u, .claude/settings.json).
#
# Kendi dalındaysan: değişiklikleri commit eder ve GitHub'a push eder. Böylece
# "push etmeyi unuttum" diye bir şey kalmaz; bilgisayar kapansa bile iş GitHub'da.
# main/master'daysan: hiçbir şey göndermez, yalnız uyarır. main'e kod sadece PR
# ile girer (GitHub'daki dal koruması zaten reddeder).
#
# Gizli dosyalar (.env, anahtarlar) ve 25 MB'tan büyük yeni dosyalar commit'e
# alınmaz; uyarı verilir.
set -u
girdi=$(cat)

uyar() { printf '{"systemMessage": "%s"}\n' "$1"; exit 0; }

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# detached HEAD, rebase ya da merge ortası: dokunma
dal=$(git symbolic-ref --quiet --short HEAD) || exit 0
gd=$(git rev-parse --git-dir)
if [ -d "$gd/rebase-merge" ] || [ -d "$gd/rebase-apply" ] || [ -f "$gd/MERGE_HEAD" ]; then exit 0; fi

case "$dal" in
  main|master)
    [ -n "$(git status --porcelain)" ] && uyar "oto-push: main dalındasın, değişiklikler GitHub'a gönderilmedi. Yeni iş için önce dal aç (örnek: ali/kasa-iade)."
    exit 0 ;;
esac

git add -A 2>/dev/null

# yeni eklenen dosyalarda gizli bilgi / büyük dosya koruması
cikarilan=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.env.example|*.env.sample) continue ;;
    .env|*/.env|.env.*|*/.env.*|*.pem|*.key|*.p12|*.pfx|*id_rsa*|*id_ed25519*|*.keystore|*.jks|*.sql.gz|*.dump)
      cikarilan+=("$f") ;;
    *)
      boyut=$(git cat-file -s ":$f" 2>/dev/null || echo 0)
      [ "$boyut" -gt 26214400 ] && cikarilan+=("$f") ;;
  esac
done < <(git diff --cached --name-only --diff-filter=A)
for f in "${cikarilan[@]+"${cikarilan[@]}"}"; do git reset -q -- "$f"; done

if ! git diff --cached --quiet; then
  if ! git commit -q -m "oto: $(git config user.name || echo ekip) — $(date '+%Y-%m-%d %H:%M')" >/dev/null 2>&1; then
    uyar "oto-push: commit başarısız oldu (pre-commit hook?). Değişiklikler kaydedilmedi."
  fi
fi

git remote get-url origin >/dev/null 2>&1 || exit 0

# gönderilecek bir şey var mı: upstream yoksa ya da önündeysek
if git rev-parse --verify -q '@{u}' >/dev/null && [ -z "$(git log '@{u}..HEAD' --oneline 2>/dev/null)" ]; then
  [ ${#cikarilan[@]} -gt 0 ] && uyar "oto-push: şu dosyalar gizli/büyük olduğu için commit'e alınmadı: ${cikarilan[*]}"
  exit 0
fi

if ! hata=$(git push -q -u origin "$dal" 2>&1); then
  if echo "$hata" | grep -qiE 'rejected|fetch first|non-fast-forward'; then
    # aynı turda ikinci kez durdurma — sonsuz döngü olmasın
    echo "$girdi" | grep -q '"stop_hook_active": *true' && uyar "oto-push: push reddedildi, uzak dalda yeni commit var. 'git pull --rebase' gerekiyor."
    echo "oto-push: '$dal' dalına push reddedildi — GitHub'da bu dalda senin bilgisayarında olmayan commit var (ekipten biri aynı dalda çalışmış). 'git pull --rebase origin $dal' yap, çakışma çıkarsa çöz ve kullanıcıya özetle, sonra bitir." >&2
    exit 2
  fi
  uyar "oto-push: GitHub'a gönderilemedi (internet/yetki?). İş bilgisayarda commit'li duruyor, sonraki turda tekrar denenecek."
fi

[ ${#cikarilan[@]} -gt 0 ] && uyar "oto-push: gönderildi; ama şu dosyalar gizli/büyük olduğu için commit'e alınmadı: ${cikarilan[*]}"
exit 0
