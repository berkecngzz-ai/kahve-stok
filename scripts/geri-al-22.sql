-- 22_gunluk_kontrol.sql GERİ ALMA. Yalnız işlevleri kaldırır; elle girilen mal kabulleri (girisler) kalır.
begin;
drop function if exists public.elle_mal_kabul(uuid, text, jsonb), public.fiyat_degisimleri(), public.gunluk_kontrol(),
  public.barista_durumu();
commit;
