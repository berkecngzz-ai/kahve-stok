#!/usr/bin/env bash
# OKUMA TESTİ — tek komut. Klasördeki fatura FOTOĞRAFLARINI (jpg/jpeg/png) AI ile okutur, 00_CEVAP_ANAHTARI.md ile
# karşılaştırıp rapor basar. Test yolunu açar, bitince (hata olsa bile) kapatır ve yüklediği test görüntülerini siler.
#
# Kullanım:  bash scripts/okuma-testi.sh [klasör] [modeller]
#   örnek:   bash scripts/okuma-testi.sh "$HOME/OneDrive/Desktop/test-faturalar" gpt-4.1-mini
#            bash scripts/okuma-testi.sh "$HOME/OneDrive/Desktop/test-faturalar" gpt-4.1-mini,gpt-4.1-nano
# Gerekenler: Supabase CLI girişi (npx supabase login, bir kez), Node 20+, `npm install` (raporlama için).
# Not: PDF ve XML faturalar AI'sız okunduğu için bu teste girmez; onlar uygulamadaki Okuma testi ekranında denenir.
# Test okumaları mekanların günlük sınırından düşmez; okuma_testleri tablosunda (maliyetiyle) kalır.
set -euo pipefail

KOK="$(cd "$(dirname "$0")/.." && pwd)"
KLASOR="${1:-$HOME/OneDrive/Desktop/test-faturalar}"
MODELLER="${2:-gpt-4.1-mini}"
REF=urklrolemeacguleadwa
ETIKET="t$(date +%Y%m%d%H%M%S)"
GECICI="$(mktemp -d)"
ANAHTAR="$KLASOR/00_CEVAP_ANAHTARI.md"

supa() { (cd "$KOK" && npx supabase "$@"); }
sorgu() { supa db query --linked --project-ref "$REF" "$@"; }
bekle() { node -e "setTimeout(() => {}, $1)"; }

[ -f "$ANAHTAR" ] || { echo "Cevap anahtarı yok: $ANAHTAR"; exit 1; }
mapfile -t FOTOLAR < <(cd "$KLASOR" && ls -1 *.jpg *.jpeg *.png *.JPG *.JPEG *.PNG 2>/dev/null | sort -u || true)
[ "${#FOTOLAR[@]}" -gt 0 ] || { echo "Klasörde fotoğraf (jpg/jpeg/png) yok: $KLASOR"; exit 1; }

# Ekrana yazan asıl çıkış (3/4) saklanır: bir komut yönlendirilmiş çıktıdayken hata verirse temizlik mesajları
# o dosyaya gidip kayboluyordu (test yolunun kapanıp kapanmadığı görünmüyordu).
exec 3>&1 4>&2
temizle() {
  exec 1>&3 2>&4
  echo "→ Test görüntüleri siliniyor ve test yolu kapatılıyor…"
  for f in "${FOTOLAR[@]}"; do
    (cd "$KLASOR" && npx --prefix "$KOK" supabase storage rm "ss:///fatura-belgeleri/_test/$ETIKET/$f" \
      --linked --project-ref "$REF" --experimental --yes --workdir "$KOK") >/dev/null 2>&1 || true
  done
  if sorgu "select public.okuma_testi_ac(false)" 2>/dev/null | grep -q "KAPALI"; then echo "✓ Test yolu KAPALI."
  else echo "UYARI: test yolu kapatılamadı; elle: select public.okuma_testi_ac(false);"; fi
  rm -rf "$GECICI"
}
trap temizle EXIT

echo "→ Test yolu açılıyor (${#FOTOLAR[@]} fotoğraf × $MODELLER)…"
sorgu "select public.okuma_testi_ac(true)" >/dev/null

for f in "${FOTOLAR[@]}"; do
  echo "  yükleniyor: $f"
  (cd "$KLASOR" && npx --prefix "$KOK" supabase storage cp "./$f" "ss:///fatura-belgeleri/_test/$ETIKET/$f" \
    --linked --project-ref "$REF" --experimental --workdir "$KOK") >/dev/null
done

node "$KOK/test/okuma-testi-hazirla.mjs" "$ANAHTAR" "$ETIKET" "$MODELLER" "${FOTOLAR[@]}" > "$GECICI/ekle.sql"
sorgu -f "$GECICI/ekle.sql" >/dev/null
echo "→ Okunuyor…"

for i in $(seq 1 60); do
  bekleyen=$(sorgu "select count(*) as n from public.okuma_testleri where etiket = '$ETIKET' and durum = 'bekliyor'" 2>/dev/null \
    | grep -o '"n": *[0-9]*' | grep -o '[0-9]*$' || echo "?")
  [ "$bekleyen" = "0" ] && break
  bekle 5000
done
[ "$bekleyen" = "0" ] || echo "UYARI: bazı okumalar 5 dakikada bitmedi; rapor eksik olabilir."

# Not: sorgu TEK SATIR olmalı — Windows'ta npx komut satırındaki satır sonunu keser, sorgu bozulur.
sorgu "select dosya_yolu, model, malzemeler, sonuc, durum, hata, giris_token, cikis_token, maliyet_usd, ai_ms, toplam_ms, boyut_kb from public.okuma_testleri where etiket = '$ETIKET' and durum = 'tamam' order by dosya_yolu, model" > "$GECICI/sonuc.json"
cp "$GECICI/sonuc.json" "$KLASOR/sonuc-$ETIKET.json"   # ham sonuç klasörde kalır (yeniden puanlamak için)
sorgu "select dosya_yolu, model, hata from public.okuma_testleri where etiket = '$ETIKET' and durum <> 'tamam'" 2>/dev/null \
  | grep -o '"dosya_yolu": *"[^"]*"\|"model": *"[^"]*"\|"hata": *"[^"]*"' | paste - - - || true

echo
echo "=================== OKUMA TESTİ RAPORU ($ETIKET) ==================="
node "$KOK/test/okuma-testi-raporu.mjs" "$GECICI/sonuc.json" "$ANAHTAR"
