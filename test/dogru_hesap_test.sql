-- 26_dogru_hesap.sql: zorunlu hesaplama kuralları. Her bölüm bir kural; beklenen değerler elle hesaplanmıştır (yorumlarda).
-- Gün D = bugun(). Kafe A: sayım dönemleri, geç fatura, sayım düzeltme, ortalama maliyet, günlük süt, reçetesiz satış.
-- Kafe B: reçete sürümleri ve iptal/iade/çakışan POS.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('f6f6f6f6-0000-0000-0000-000000000001','patronDA@x.com'),
 ('f6f6f6f6-0000-0000-0000-000000000002','baristaDA@x.com'),
 ('f6f6f6f6-0000-0000-0000-000000000003','patronDB@x.com');

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
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000001','patronDA@x.com');
select public.mekan_olustur('Kafe DA','Deniz');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe DA' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',50), ('Kahve','g',1000), ('Bardak','adet',2);
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'ma' \gset
select id as kahve from malzemeler where ad = 'Kahve' and mekan_id = :'ma' \gset
select id as bardak from malzemeler where ad = 'Bardak' and mekan_id = :'ma' \gset
-- Latte v1 (180 ml) D-30'dan, v2 (200 ml) D-10'dan; Espresso 18 g
select public.urun_kaydet(null, 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18),
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 180), jsonb_build_object('malzeme_id', :'bardak', 'miktar', 1)), public.bugun() - 30) as latte \gset
select public.urun_kaydet(:'latte', 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18),
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 200), jsonb_build_object('malzeme_id', :'bardak', 'miktar', 1)), public.bugun() - 10);
select public.urun_kaydet(null, 'Espresso', jsonb_build_array(jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18)), public.bugun() - 30) as espresso \gset
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000002','baristaDA@x.com');
select public.mekana_katil(:'kod','Bora');

-- Dönem 1: sayım D-20 → D-13
select pg_temp.sayim(public.bugun() - 20, jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 20000),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 5000), jsonb_build_object('malzeme_id', :'bardak', 'miktar', 500))) as s20 \gset
-- D-18 fatura: 12 L süt 600 TL (0,05 TL/ml), 2 kg kahve 2.000 TL (1 TL/g), 2 koli × 50 bardak 200 TL (2 TL/adet)
select pg_temp.fatura(repeat('a', 64), public.bugun() - 18, 2800, jsonb_build_array(
  pg_temp.kalem('SÜT 1L', 12, 'adet', :'sut', 1000, 600), pg_temp.kalem('ÇEKİRDEK 1KG', 2, 'kg', :'kahve', 1000, 2000),
  pg_temp.kalem('BARDAK 50LI KOLI', 2, 'diger', :'bardak', 50, 200))) as f18 \gset
reset role;
select pg_temp.dogrula((:'f18')::jsonb ->> 'durum' = 'tamam', 'D-18 faturası stoğa girmedi: ' || :'f18' || ' ' ||
  (select string_agg(metin || ':' || coalesce(bekleme_sebebi, '-') || ':' || durum, ' | ') from belge_satirlari where belge_id = ((:'f18')::jsonb ->> 'id')::uuid));
set role authenticated;
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000001','patronDA@x.com');
-- D-17 satış: 10 Latte (v1: 180 ml) + 5 Espresso → süt 1.800, kahve 270, bardak 10
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 17, 'Latte', :'latte', 10), pg_temp.satir(public.bugun() - 17, 'Espresso', :'espresso', 5))) as r17 \gset
select pg_temp.dogrula((:'r17')::jsonb ->> 'eklenen' = '2' and (:'r17')::jsonb ->> 'mukerrer' = '0', 'D-17 raporu: ' || :'r17');
select pg_temp.dogrula(pg_temp.tuketim(:'ma', public.bugun() - 17, :'sut') = 1800, 'D-17 süt tüketimi 1.800 değil');
select pg_temp.dogrula(pg_temp.tuketim(:'ma', public.bugun() - 17, :'kahve') = 270, 'D-17 kahve tüketimi 270 değil');
-- D-16 fire: 500 ml süt
select public.giris_kaydet('fire', public.bugun() - 16, 'Döküldü', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 500)));
-- D-14: geç gelen fatura (fatura tarihi D-14, fiziksel teslim D-12): 6 L süt 360 TL (0,06 TL/ml)
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000002','baristaDA@x.com');
select pg_temp.fatura(repeat('b', 64), public.bugun() - 14, 360, jsonb_build_array(pg_temp.kalem('SÜT 1L', 6, 'adet', :'sut', 1000, 360))) as f14 \gset
reset role;
select giris_id as f14_giris from belgeler where id = ((:'f14')::jsonb ->> 'id')::uuid \gset
set role authenticated;
-- Aynı fatura ikinci kez yüklenemez
select pg_temp.hata_bekle(format($$select pg_temp.fatura(%L, public.bugun() - 14, 360, '[]')$$, repeat('b', 64)), 'daha önce yüklenmiş');
-- D-13 haftalık sayım. Beklenen süt (teslim tarihi düzeltilmeden, fatura D-14'te sayılır):
--   20.000 + 12.000 + 6.000 − 1.800 − 500 = 35.700; sayılan 29.000 (6 L henüz gelmedi) → sahte −6.700
select pg_temp.sayim(public.bugun() - 13, jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 29000),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 6700), jsonb_build_object('malzeme_id', :'bardak', 'miktar', 590))) as s13 \gset
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000001','patronDA@x.com');
select public.stok_farki(:'s13') as r13a \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'r13a')::jsonb, :'sut') ->> 'fark')::numeric = -6700, 'teslim düzeltmesi öncesi süt farkı −6.700 değil: ' || (pg_temp.satir_bul((:'r13a')::jsonb, :'sut'))::text);

-- KURAL: Geç yüklenen fatura teslim tarihine taşınır; dönem yeniden hesaplanır
select pg_temp.hata_bekle(format($$select public.fatura_teslim_tarihi(%L, public.bugun() + 1)$$, :'f14_giris'), 'Teslim tarihi geçersiz');
select public.fatura_teslim_tarihi(:'f14_giris', public.bugun() - 12);
select public.stok_farki(:'s13') as r13 \gset
-- Dönem 1 sonucu: süt beklenen 29.700, sayılan 29.000 → −700 ml × 0,05 = −35,00 TL (D-13 itibarıyla ortalama yalnız D-18 faturası)
select pg_temp.dogrula((pg_temp.satir_bul((:'r13')::jsonb, :'sut') ->> 'beklenen')::numeric = 29700, 'süt beklenen 29.700 değil');
select pg_temp.dogrula((pg_temp.satir_bul((:'r13')::jsonb, :'sut') ->> 'fark')::numeric = -700, 'süt farkı −700 değil');
select pg_temp.dogrula((pg_temp.satir_bul((:'r13')::jsonb, :'sut') ->> 'fark_tl')::numeric = -35, 'süt TL −35 değil: ' || (pg_temp.satir_bul((:'r13')::jsonb, :'sut'))::text);
-- Kahve: 5.000 + 2.000 − 270 = 6.730; sayılan 6.700 → −30 g × 1 TL = −30 TL
select pg_temp.dogrula((pg_temp.satir_bul((:'r13')::jsonb, :'kahve') ->> 'fark_tl')::numeric = -30, 'kahve TL −30 değil');
-- KURAL: koli/adet dönüşümü: bardak 500 + 2×50 − 10 = 590 → fark 0; birim maliyet 2 TL/adet
select pg_temp.dogrula((pg_temp.satir_bul((:'r13')::jsonb, :'bardak') ->> 'fark')::numeric = 0
  and (pg_temp.satir_bul((:'r13')::jsonb, :'bardak') ->> 'fiyat')::numeric = 2, 'bardak koli dönüşümü / maliyet yanlış');
select pg_temp.dogrula((:'r13')::jsonb ->> 'toplam_acik_tl' = '-65.00' or ((:'r13')::jsonb ->> 'toplam_acik_tl')::numeric = -65, 'toplam açık −65 değil');
-- Düzeltme işlem geçmişinde
reset role;
select pg_temp.dogrula(exists (select 1 from islem_gecmisi where mekan_id = :'ma' and tur = 'teslim_tarihi'
  and ayrinti ->> 'yeni' = (public.bugun() - 12)::text), 'teslim tarihi düzeltmesi kaydedilmedi');
set role authenticated;

-- Dönem 2: D-13 → D-6. D-11 10 Latte (v1, 180 ml), D-9 10 Latte (v2, 200 ml), D-8 günlük süt sayımı (dar)
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 11, 'Latte', :'latte', 10), pg_temp.satir(public.bugun() - 9, 'Latte', :'latte', 10),
  pg_temp.satir(public.bugun() - 9, 'San Sebastian', null, 4)));
-- KURAL: Reçete geçmişi — her satış kendi gününün reçetesiyle
select pg_temp.dogrula(pg_temp.tuketim(:'ma', public.bugun() - 11, :'sut') = 1800, 'D-11 v1 (180 ml) ile hesaplanmadı: ' || pg_temp.tuketim(:'ma', public.bugun() - 11, :'sut') || ' ' || (select string_agg(baslangic || ':' || miktar, ',') from tarif_surumleri where urun_id = :'latte' and malzeme_id = :'sut'));
select pg_temp.dogrula(pg_temp.tuketim(:'ma', public.bugun() - 9, :'sut') = 2000, 'D-9 v2 (200 ml) ile hesaplanmadı');
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000002','baristaDA@x.com');
-- Günlük süt sayımı D-8: 29.000 + 6.000 − 1.800 − 2.000 = 31.200
select pg_temp.sayim(public.bugun() - 8, jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 31200))) as s8 \gset
-- Haftalık sayım D-6: süt 31.200, kahve 6.700 − 360 = 6.340, bardak 590 − 20 = 570 → hepsi 0
select pg_temp.sayim(public.bugun() - 6, jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 31200),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 6340), jsonb_build_object('malzeme_id', :'bardak', 'miktar', 570))) as s6 \gset
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000001','patronDA@x.com');
select public.stok_farki(:'s6') as r6 \gset
-- KURAL: Sayım sonrası başlangıç — dönem 1'in −700 açığı dönem 2'ye taşınmaz; günlük sayım haftalığı bölmez
select pg_temp.dogrula((pg_temp.satir_bul((:'r6')::jsonb, :'sut') ->> 'baslangic_tarih')::date = public.bugun() - 13,
  'haftalık raporda süt başlangıcı önceki haftalık sayım değil: ' || (pg_temp.satir_bul((:'r6')::jsonb, :'sut'))::text);
select pg_temp.dogrula((pg_temp.satir_bul((:'r6')::jsonb, :'sut') ->> 'fark')::numeric = 0
  and (pg_temp.satir_bul((:'r6')::jsonb, :'kahve') ->> 'fark')::numeric = 0
  and (pg_temp.satir_bul((:'r6')::jsonb, :'bardak') ->> 'fark')::numeric = 0, 'dönem 2 farkı 0 değil (açık taşındı?): ' || (:'r6'));
select pg_temp.dogrula(((:'r6')::jsonb ->> 'toplam_acik_tl')::numeric = 0, 'dönem 2 açığı 0 değil');
-- Günlük (dar) sayım raporu: başlangıç D-13, bitiş D-8, fark 0
select public.stok_farki(:'s8') as r8 \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'r8')::jsonb, :'sut') ->> 'fark')::numeric = 0
  and not ((:'r8')::jsonb ->> 'genis')::boolean, 'günlük süt raporu yanlış');
-- Trend yalnız geniş sayımlar: D-13 ve D-6 (D-8 günlük girmez)
select public.acik_trendi(8) as tr \gset
select pg_temp.dogrula(jsonb_array_length((:'tr')::jsonb) = 2, 'trendde günlük sayım dönem sayıldı: ' || (:'tr'));
-- KURAL: Reçetesiz ürün — sessizce sıfır değil, uyarı
select pg_temp.dogrula(exists (select 1 from jsonb_array_elements_text((:'r6')::jsonb -> 'uyarilar') u where u like '%San Sebastian (4 adet)%'),
  'reçetesiz satış uyarısı yok: ' || ((:'r6')::jsonb -> 'uyarilar')::text);
select public.tarifsiz_satislar() as ts \gset
select pg_temp.dogrula((:'ts')::jsonb @> '[{"urun":"San Sebastian","adet":4}]', 'tarifsiz_satislar listesi yanlış: ' || (:'ts'));
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000002','baristaDA@x.com');
select pg_temp.dogrula((public.barista_durumu() -> 'tarifsiz') @> '[{"urun":"San Sebastian"}]', 'barista reçetesiz uyarısını görmüyor');

-- KURAL: Hatalı sayım düzeltme. D-4 10 Latte (v2: 2.000 ml), D-3 günlük süt: gerçek 29.200, barista 9.200 yazdı
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000001','patronDA@x.com');
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(pg_temp.satir(public.bugun() - 4, 'Latte', :'latte', 10)));
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000002','baristaDA@x.com');
select pg_temp.sayim(public.bugun() - 3, jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 9200))) as s3 \gset
select pg_temp.hata_bekle(format($$select public.sayim_duzelt(%L, %L, 29200)$$, :'s3', :'sut'), 'yalnız patron');
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000001','patronDA@x.com');
select public.stok_farki(:'s3') as r3a \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'r3a')::jsonb, :'sut') ->> 'fark')::numeric = -20000, 'hatalı sayım sahte açık üretmedi');
select public.sayim_duzelt(:'s3', :'sut', 29200, '18 yerine 8 yazılmış');
select public.stok_farki(:'s3') as r3 \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'r3')::jsonb, :'sut') ->> 'fark')::numeric = 0, 'düzeltme sonrası sahte açık kalktı değil');
select pg_temp.dogrula(((:'r3')::jsonb ->> 'toplam_acik_tl')::numeric = 0, 'düzeltme sonrası TL açık 0 değil');
reset role;
select pg_temp.dogrula(exists (select 1 from islem_gecmisi where mekan_id = :'ma' and tur = 'sayim_duzelt'
  and (ayrinti ->> 'eski')::numeric = 9200 and (ayrinti ->> 'yeni')::numeric = 29200 and kullanici_ad = 'Deniz'),
  'sayım düzeltme kaydı (kim / eski / yeni) yok');
set role authenticated;
-- KURAL: Ağırlıklı ortalama maliyet (D-3 itibarıyla: (600 + 360) / 18.000 ml = 0,05333 TL/ml = 53,33 TL/L)
select pg_temp.dogrula(round((pg_temp.satir_bul((:'r3')::jsonb, :'sut') ->> 'fiyat')::numeric, 2) = 53.33, 'süt ortalama maliyeti 53,33 TL/L değil: '
  || (pg_temp.satir_bul((:'r3')::jsonb, :'sut') ->> 'fiyat'));
-- KURAL: Stok güncelliği — son sayım tarihi ve kaç gün önce
select public.stok_durumu() as sd \gset
select pg_temp.dogrula((select (x ->> 'sayim_gun_once')::int = 3 from jsonb_array_elements((:'sd')::jsonb -> 'malzemeler') x
  where x ->> 'malzeme_id' = :'sut'), 'stok_durumu son sayımı 3 gün önce göstermiyor');

-- ===== Kafe B: reçete geçmişi, iptal / iade, çakışan POS =====
select pg_temp.ol('f6f6f6f6-0000-0000-0000-000000000003','patronDB@x.com');
select public.mekan_olustur('Kafe DB','Ece');
select id as mb from mekanlar where ad = 'Kafe DB' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40);
select id as sutb from malzemeler where ad = 'Süt' and mekan_id = :'mb' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'sutb', 'miktar', 180)), public.bugun() - 20) as latteb \gset
select public.urun_kaydet(:'latteb', 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'sutb', 'miktar', 200)), public.bugun() - 10);

-- Reçete geçmişi: D-9 satışı v2; sonra geç gelen D-15 satışı v1; v3 (220 ml, bugün) geçmişi değiştirmez
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(pg_temp.satir(public.bugun() - 9, 'Latte', :'latteb', 1)));
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(pg_temp.satir(public.bugun() - 15, 'Latte', :'latteb', 1)));
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 15, :'sutb') = 180, 'geç gelen satış kendi gününün reçetesiyle (180) hesaplanmadı');
select public.urun_kaydet(:'latteb', 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'sutb', 'miktar', 220)));
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 9, :'sutb') = 200, 'reçete değişince geçmiş satış yeniden hesaplandı');
select pg_temp.dogrula((select miktar = 220 from tarif_kalemleri where urun_id = :'latteb'), 'güncel reçete v3 değil');
-- Geçmiş tarihli düzeltme güncel reçeteyi bozmaz
select public.urun_kaydet(:'latteb', 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'sutb', 'miktar', 190)), public.bugun() - 5);
select pg_temp.dogrula((select miktar = 220 from tarif_kalemleri where urun_id = :'latteb'), 'geçmiş tarihli sürüm güncel reçeteyi değiştirdi');

-- İptal / iade (D-7). Dosya 1: F1 3 satış; F2 2 satış + 1 iptal (hazırlanmadan); F3 1 iade (verildi, para iade); saatli 1 satış
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 3, 'satis', 'F1'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 2, 'satis', 'F2'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'iptal', 'F2'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'satis', 'F3'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'iade', 'F3'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'satis', null, (public.bugun() - 7) || ' 10:00:00', 165))) as p1 \gset
-- Tüketim: F1 3 + F2 (2−1) + F3 1 (iade stoğu artırmaz) + saatli 1 = 6 Latte × 200 ml (v2 D-10'dan) = 1.200
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 7, :'sutb') = 1200, 'iptal/iade sonrası tüketim 1.200 değil: '
  || pg_temp.tuketim(:'mb', public.bugun() - 7, :'sutb'));
-- KURAL: Çakışan POS dosyası: F1, F2-iptal ve saatli satış zaten var (3 mükerrer); F4 yeni (1 satış)
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 3, 'satis', 'F1'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'iptal', 'F2'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'satis', null, (public.bugun() - 7) || ' 10:00:00', 165),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'satis', 'F4'))) as p2 \gset
select pg_temp.dogrula((:'p2')::jsonb ->> 'mukerrer' = '3' and (:'p2')::jsonb ->> 'eklenen' = '1', 'çakışan dosya sayıları yanlış: ' || (:'p2'));
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 7, :'sutb') = 1400, 'çakışan dosya sonrası tüketim 1.400 değil');
-- Sonradan gelen iptal (F4, önceden tüketim kaydedilmiş): yalnız o tüketim geri alınır; aynı iptal tekrar gelirse etkisiz
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'iptal', 'F4')));
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 7, :'sutb') = 1200, 'sonradan iptal tüketimi geri almadı');
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 1, 'iptal', 'F4'))) as p4 \gset
select pg_temp.dogrula((:'p4')::jsonb ->> 'mukerrer' = '1' and pg_temp.tuketim(:'mb', public.bugun() - 7, :'sutb') = 1200, 'aynı iptal iki kez işlendi');
-- Satışı hiç gelmemiş iptal (F9) ve fazla iptal (F1'e 5 iptal): stok asla eksiye dönmez / artmaz
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 2, 'iptal', 'F9'),
  pg_temp.satir(public.bugun() - 7, 'Latte', :'latteb', 5, 'iptal', 'F1')));
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 7, :'sutb') = 600, 'fazla iptal stoğu artırdı ya da yanlış düştü: '
  || pg_temp.tuketim(:'mb', public.bugun() - 7, :'sutb'));
-- Fişsiz özet satırlar (gün + ürün + adet + tutar): çakışan iki dosya
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 6, 'Latte', :'latteb', 5, 'satis', null, null, 825), pg_temp.satir(public.bugun() - 5, 'Latte', :'latteb', 4, 'satis', null, null, 660)));
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 5, 'Latte', :'latteb', 4, 'satis', null, null, 660), pg_temp.satir(public.bugun() - 4, 'Latte', :'latteb', 2, 'satis', null, null, 330))) as p6 \gset
select pg_temp.dogrula((:'p6')::jsonb ->> 'mukerrer' = '1', 'özet satır çakışması yakalanmadı');
-- D-5'te geçerli sürüm 190 ml (geçmiş tarihli düzeltme) → 4 × 190 = 760
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 5, :'sutb') = 760, 'D-5 tüketimi 760 değil');

-- Satış günü iptal edilince satırları serbest kalır (rapor düzeltilip yeniden yüklenebilir)
select id as gun4 from girisler where mekan_id = :'mb' and tur = 'satis' and tarih = public.bugun() - 4 and iptal_zamani is null \gset
select public.giris_iptal(:'gun4');
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 4, 'Latte', :'latteb', 2, 'satis', null, null, 330))) as p7 \gset
select pg_temp.dogrula((:'p7')::jsonb ->> 'eklenen' = '1', 'iptal edilen günün satırları yeniden yüklenemedi');

-- Eski usul (elle, satırsız) satış girişi aynı gün varsa ona dokunulmaz; rapor ayrı satış günü girişi açar
reset role;
insert into girisler (id, mekan_id, tur, tarih, aciklama, giren, giren_ad)
  values ('e5e5e5e5-0000-0000-0000-000000000001', :'mb', 'satis', public.bugun() - 3, null, 'f6f6f6f6-0000-0000-0000-000000000003', 'Ece');
insert into giris_kalemleri (giris_id, mekan_id, urun_id, miktar) values ('e5e5e5e5-0000-0000-0000-000000000001', :'mb', :'latteb', 7);
insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar) values ('e5e5e5e5-0000-0000-0000-000000000001', :'mb', :'sutb', 1400);
set role authenticated;
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(pg_temp.satir(public.bugun() - 3, 'Latte', :'latteb', 1, 'satis', 'F50')));
reset role;
select pg_temp.dogrula((select miktar = 1400 from malzeme_hareketleri where giris_id = 'e5e5e5e5-0000-0000-0000-000000000001'), 'eski usul satış girişi bozuldu');
set role authenticated;
select pg_temp.dogrula(pg_temp.tuketim(:'mb', public.bugun() - 3, :'sutb') = 1400 + 190, 'eski + yeni satış toplamı yanlış');

-- İzolasyon: Kafe B, Kafe A'nın satış satırlarını görmez; başka mekanın ürünü yazılamaz
select count(*) as gor from satis_satirlari where mekan_id = :'ma' \gset
select pg_temp.dogrula(:'gor'::int = 0, 'başka mekanın satış satırları görünüyor');
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(pg_temp.rapor(%L), '[%s]')$$, :'mb',
  pg_temp.satir(public.bugun() - 2, 'Latte', :'latte', 1)), 'bu mekana ait olmayan');
select pg_temp.hata_bekle(format($$select public.sayim_duzelt(%L, %L, 1)$$, :'s3', :'sut'), 'Sayım bulunamadı');
reset role;
