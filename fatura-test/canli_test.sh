#!/usr/bin/env bash
# Uygulamanın CANLI okuyucusuyla fatura-test'i çalıştırır (OpenAI harcar: okuma başı ≈ $0,003). Test yolunu açar,
# görüntüleri yükler, bitince (hata olsa bile) görüntüleri siler ve test yolunu kapatır. scripts/okuma-testi.sh ile aynı mantık.
# Kullanım: bash fatura-test/canli_test.sh [run_test.py argümanları]   örn: --runs 3     |   --only 01
set -euo pipefail
KOK="$(cd "$(dirname "$0")/.." && pwd)"
REF=urklrolemeacguleadwa
ETIKET="ft$(date +%Y%m%d%H%M%S)"
IMG="$KOK/fatura-test/data/images"
sorgu() { (cd "$KOK" && npx supabase db query --linked --project-ref "$REF" "$@"); }

exec 3>&1 4>&2
temizle() {
  exec 1>&3 2>&4
  echo "→ Test görüntüleri siliniyor ve test yolu kapatılıyor…"
  for f in "$IMG"/*.jpg; do
    (cd "$IMG" && npx --prefix "$KOK" supabase storage rm "ss:///fatura-belgeleri/_test/$ETIKET/$(basename "$f")" \
      --linked --project-ref "$REF" --experimental --yes --workdir "$KOK") >/dev/null 2>&1 || true
  done
  if sorgu "select public.okuma_testi_ac(false)" 2>/dev/null | grep -q "KAPALI"; then echo "✓ Test yolu KAPALI."
  else echo "UYARI: test yolu kapatılamadı; elle: select public.okuma_testi_ac(false);"; fi
}
trap temizle EXIT

echo "→ Test yolu açılıyor…"
sorgu "select public.okuma_testi_ac(true)" >/dev/null
for f in "$IMG"/*.jpg; do
  echo "  yükleniyor: $(basename "$f")"
  (cd "$IMG" && npx --prefix "$KOK" supabase storage cp "./$(basename "$f")" "ss:///fatura-belgeleri/_test/$ETIKET/$(basename "$f")" \
    --linked --project-ref "$REF" --experimental --workdir "$KOK") >/dev/null
done

export ETIKET PYTHONUTF8=1
export READER_CMD="node $(cygpath -m "$KOK")/fatura-test/readers/uygulama_okuyucu.mjs"
python "$KOK/fatura-test/run_test.py" --reader command "$@"
