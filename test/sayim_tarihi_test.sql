-- 29_sayim_tarihi.sql: akşam testi senaryosu. Her şey AYNI gün (bugün) girilir; ilk sayım düne alınınca rapor doğru çıkar.
-- Kurallar: yalnız patron; gelecek tarih yok; o güne başka sayım varsa red; başka mekanın sayımı bulunamaz; geçmişe yazılır.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('a9a9a9a9-0000-0000-0000-000000000001','patronST@x.com'),
 ('a9a9a9a9-0000-0000-0000-000000000002','baristaST@x.com'),
 ('a9a9a9a9-0000-0000-0000-000000000003','patronST2@x.com');

create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.hata_bekle(q text, beklenen text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm not like '%' || beklenen || '%' then raise exception 'Beklenmeyen hata: % (sorgu: %)', sqlerrm, q; end if;
    return;
  end;
  raise exception 'Hata bekleniyordu ama olmadı: %', q;
end $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
-- Fatura: barista saydı, eşleşmiş satırlar (tutar KDV dahil)
create or replace function pg_temp.fatura(ozet text, tarih date, genel numeric, satirlar jsonb) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'dosya_ozeti', ozet, 'tedarikci', 'Toptan Gıda',
    'tedarikci_vkn', '5555555555', 'tarih', tarih, 'toplamlar', jsonb_build_object('genel', genel),
    'okunan', jsonb_build_object('not', 'test'), 'satirlar', satirlar)) $$;
create or replace function pg_temp.kalem(metin text, miktar numeric, birim text, malzeme uuid, carpan numeric, tutar numeric) returns jsonb
language sql as $$
  select jsonb_build_object('metin', metin, 'miktar', miktar, 'birim', birim, 'sinif', 'eslesti', 'malzeme_id', malzeme,
    'carpan', carpan, 'barista_onayi', true, 'gelen_miktar', miktar, 'sayim', 'sayildi', 'teslimat', 'tam', 'tutar_dahil', tutar) $$;
-- Satış raporu belgesi (dosyası depoda)
create or replace function pg_temp.rapor(mekan uuid) returns uuid language plpgsql as $$
declare v_yol text := mekan || '/' || gen_random_uuid() || '/rapor.csv';
begin
  execute 'reset role';
  insert into storage.objects (bucket_id, name) values ('fatura-belgeleri', v_yol);
  execute 'set role authenticated';
  return (public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
    'dosyalar', jsonb_build_array(v_yol))) ->> 'id')::uuid;
end $$;
create or replace function pg_temp.satir(tarih date, ad text, urun uuid, adet int, tur text default 'satis', fis text default null,
  zaman text default null, tutar numeric default null) returns jsonb language sql as $$
  select jsonb_build_object('tarih', tarih, 'ad', ad, 'ad_anahtar', lower(ad), 'urun_id', urun, 'adet', adet, 'tur', tur,
    'fis_no', fis, 'zaman', zaman, 'tutar', tutar) $$;
create or replace function pg_temp.sayim(tarih date, kalemler jsonb) returns uuid language sql as $$
  select public.giris_kaydet('sayim', tarih, null, kalemler) $$;
create or replace function pg_temp.satir_bul(r jsonb, malzeme uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(r -> 'satirlar') x where x ->> 'malzeme_id' = malzeme::text $$;
-- Bir satış gününün bir malzemedeki tüketimi
create or replace function pg_temp.tuketim(mekan uuid, tarih date, malzeme uuid) returns numeric language sql as $$
  select coalesce(sum(h.miktar), 0) from public.malzeme_hareketleri h join public.girisler g on g.id = h.giris_id
  where g.mekan_id = $1 and g.tur = 'satis' and g.tarih = $2 and g.iptal_zamani is null and h.malzeme_id = $3 $$;

set role authenticated;

-- ===== Kafe A =====
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000001','patronST@x.com');
-- ===== Kafe ST: akşam testi (her şey bugün) =====
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000001','patronST@x.com');
select public.mekan_olustur('Kafe ST','Selin');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe ST' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',50), ('Kahve','g',1000);
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'ma' \gset
select id as kahve from malzemeler where ad = 'Kahve' and mekan_id = :'ma' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18),
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 200))) as latte \gset
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000002','baristaST@x.com');
select public.mekana_katil(:'kod','Can');

-- 1) Başlangıç sayımı (bugün): süt 10 L, kahve 2 kg
select pg_temp.sayim(public.bugun(), jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 10000),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 2000))) as s1 \gset
-- Barista tarihi düzeltemez
select pg_temp.hata_bekle(format($$select public.sayim_tarihi(%L, public.bugun() - 1)$$, :'s1'), 'yalnız patron');

-- 2) Patron başlangıç sayımını düne alır (gelecek tarih reddedilir)
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000001','patronST@x.com');
select pg_temp.hata_bekle(format($$select public.sayim_tarihi(%L, public.bugun() + 1)$$, :'s1'), 'Sayım tarihi geçersiz');
select public.sayim_tarihi(:'s1', public.bugun() - 1);

-- 3) Bugün: fatura 12 L süt (600 TL) + 1 kg kahve (1.000 TL)
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000002','baristaST@x.com');
select pg_temp.fatura(repeat('e', 64), public.bugun(), 1600, jsonb_build_array(
  pg_temp.kalem('SÜT 1L', 12, 'adet', :'sut', 1000, 600), pg_temp.kalem('ÇEKİRDEK 1KG', 1, 'kg', :'kahve', 1000, 1000))) as f1 \gset
select pg_temp.dogrula((:'f1')::jsonb ->> 'durum' = 'tamam', 'fatura stoğa girmedi: ' || :'f1');
-- 4) Bugün: fire 500 ml süt
select public.giris_kaydet('fire', public.bugun(), 'Döküldü', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 500)));
-- 5) Bugün: patron kasadan 20 Latte yükler → süt 4.000, kahve 360
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000001','patronST@x.com');
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(pg_temp.satir(public.bugun(), 'Latte', :'latte', 20))) as r1 \gset
-- 6) Bugün: bitiş sayımı. Süt beklenen 10.000 + 12.000 − 4.000 − 500 = 17.500; sayılan 17.000 → −500 ml.
--    Kahve beklenen 2.000 + 1.000 − 360 = 2.640; sayılan 2.640 → 0.
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000002','baristaST@x.com');
select pg_temp.sayim(public.bugun(), jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 17000),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 2640))) as s2 \gset
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000001','patronST@x.com');
select public.stok_farki(:'s2') as rap \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'rap')::jsonb, :'sut') ->> 'beklenen')::numeric = 17500, 'süt beklenen 17.500 değil: ' || (pg_temp.satir_bul((:'rap')::jsonb, :'sut'))::text);
select pg_temp.dogrula((pg_temp.satir_bul((:'rap')::jsonb, :'sut') ->> 'fark')::numeric = -500, 'süt farkı −500 değil');
-- Ortalama alış maliyeti 600 TL / 12.000 ml = 0,05 TL/ml → −25 TL
select pg_temp.dogrula((pg_temp.satir_bul((:'rap')::jsonb, :'sut') ->> 'fark_tl')::numeric = -25, 'süt TL −25 değil');
select pg_temp.dogrula((pg_temp.satir_bul((:'rap')::jsonb, :'kahve') ->> 'fark')::numeric = 0, 'kahve farkı 0 değil');
select pg_temp.dogrula(((:'rap')::jsonb ->> 'toplam_acik_tl')::numeric = -25, 'toplam kayıp −25 değil: ' || ((:'rap')::jsonb ->> 'toplam_acik_tl'));

-- 7) Başlangıç sayımı bitiş sayımının gününe geri alınamaz (iki sayım birleşir)
select pg_temp.hata_bekle(format($$select public.sayim_tarihi(%L, public.bugun())$$, :'s1'), 'O gün zaten bir sayım var');
-- 8) Başka mekanın patronu bu sayımı göremez/düzeltemez
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000003','patronST2@x.com');
select public.mekan_olustur('Kafe ST2','Ece');
select pg_temp.hata_bekle(format($$select public.sayim_tarihi(%L, public.bugun() - 2)$$, :'s1'), 'Sayım bulunamadı');
-- 9) Fatura girişi sayım değildir
select pg_temp.ol('a9a9a9a9-0000-0000-0000-000000000001','patronST@x.com');
reset role;
select giris_id as f1_giris from belgeler where id = ((:'f1')::jsonb ->> 'id')::uuid \gset
set role authenticated;
select pg_temp.hata_bekle(format($$select public.sayim_tarihi(%L, public.bugun() - 2)$$, :'f1_giris'), 'Sayım bulunamadı');
-- 10) İşlem geçmişinde eski/yeni tarih
reset role;
select pg_temp.dogrula(exists (select 1 from islem_gecmisi where mekan_id = :'ma' and tur = 'sayim_tarihi'
  and ayrinti ->> 'eski' = public.bugun()::text and ayrinti ->> 'yeni' = (public.bugun() - 1)::text), 'sayım tarihi düzeltmesi geçmişe yazılmadı');
