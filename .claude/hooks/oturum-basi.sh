#!/usr/bin/env bash
# Claude oturumu açılırken çalışır (SessionStart hook'u). Çıktısı Claude'a
# bağlam olarak gider: hangi daldasın, GitHub'ın gerisinde misin, ekipte kim
# hangi dalda çalışıyor.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0

git fetch -q --prune origin 2>/dev/null || { echo "Ekip düzeni: GitHub'a ulaşılamadı, dal durumu güncel olmayabilir."; exit 0; }

ana=main; git rev-parse -q --verify origin/main >/dev/null || ana=master
dal=$(git symbolic-ref --quiet --short HEAD || echo "(dal yok)")

echo "Ekip düzeni (kurallar CLAUDE.md'de). Şu anki dal: $dal"
if git rev-parse --verify -q '@{u}' >/dev/null; then
  geri=$(git rev-list --count 'HEAD..@{u}')
  [ "$geri" -gt 0 ] && echo "- Bu dal GitHub'dakinin $geri commit gerisinde: işe başlamadan 'git pull --rebase' yap."
fi
geri_ana=$(git rev-list --count "HEAD..origin/$ana" 2>/dev/null || echo 0)
[ "$geri_ana" -gt 0 ] && echo "- origin/$ana'da bu dalda olmayan $geri_ana commit var."
[ -n "$(git status --porcelain)" ] && echo "- Commit edilmemiş değişiklik var."

echo "- Son push edilen ekip dalları:"
git for-each-ref --sort=-committerdate --count=8 \
  --format='    %(refname:lstrip=3) — %(committername), %(committerdate:relative)' refs/remotes/origin \
  | grep -v ' HEAD ' || true
exit 0
