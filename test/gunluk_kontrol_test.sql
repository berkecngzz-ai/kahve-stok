-- 22_gunluk_kontrol.sql testleri: barista elle mal girişi, fiyat değişimi uyarısı, günlük kontrol, barista durumu.
-- Sıra: ... sql/21, test/mal_kabul_test.sql, sql/22, bu dosya.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('f3f3f3f3-0000-0000-0000-000000000001','patronGK@x.com'),
 ('f3f3f3f3-0000-0000-0000-000000000002','baristaGK@x.com'),
 ('f3f3f3f3-0000-0000-0000-000000000003','patronGQ@x.com');

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

set role authenticated;
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000001','patronGK@x.com');
select public.mekan_olustur('Kafe GK','Gül');
select id as mekan_gk, davet_kodu as kod_gk from mekanlar where ad = 'Kafe GK' \gset
-- Süt 40 TL/L (KDV %1 → 40,40 dahil), Kahve 1000 TL/kg (%1)
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Süt','ml',40,1), ('Kahve','g',1000,1);
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'mekan_gk' \gset
select id as kahve from malzemeler where ad = 'Kahve' and mekan_id = :'mekan_gk' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 200),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18))) as latte \gset
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000002','baristaGK@x.com');
select public.mekana_katil(:'kod_gk','Bulut');
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000003','patronGQ@x.com');
select public.mekan_olustur('Kafe GQ','Kaan');

-- ================================================================================================
-- 1) BARİSTA ELLE GİRİŞ (market fişi): stok girer, normal fiyat güncellenir, sapan fiyat güncellenmez
-- ================================================================================================
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000002','baristaGK@x.com');
select pg_temp.dogrula((public.barista_durumu() ->> 'son_sayim') is null, 'sayım yokken son sayım dolu');
-- 2 L süt, fişte 84,84 TL (42 TL/L hariç, %5 zam) → stok + fiyat 42,42 dahil
select public.elle_mal_kabul('41414141-0000-0000-0000-000000000001', 'Market', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 2000, 'tutar', 84.84))) as e1 \gset
-- Aynı istek tekrar gelirse ikinci kayıt oluşmaz
select pg_temp.dogrula(public.elle_mal_kabul('41414141-0000-0000-0000-000000000001', 'Market', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 2000, 'tutar', 84.84))) = :'e1', 'tekrar istek ikinci kayıt açtı');
-- 1 kg kahve fişte 3.000 TL (kayıtlı 1.010 → %197 sapma) → stok girer, fiyat değişmez, kontrol uyarısı
select public.elle_mal_kabul('41414141-0000-0000-0000-000000000002', null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 1000, 'tutar', 3000))) as e2 \gset
-- Tutarsız giriş (fiyat bilinmiyor): yalnız stok
select public.elle_mal_kabul('41414141-0000-0000-0000-000000000003', null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 1000))) as e3 \gset
select pg_temp.hata_bekle(format($$select public.elle_mal_kabul(gen_random_uuid(), null, '[{"malzeme_id": "%s", "miktar": 0}]')$$, :'sut'), 'miktarı yaz');
select pg_temp.hata_bekle($$select public.elle_mal_kabul(gen_random_uuid(), null, '[]')$$, 'En az bir malzeme');
-- Başka mekanın malzemesi kabul edilmez
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000003','patronGQ@x.com');
select pg_temp.hata_bekle(format($$select public.elle_mal_kabul(gen_random_uuid(), null, '[{"malzeme_id": "%s", "miktar": 5}]')$$, :'sut'), 'Malzeme bulunamadı');
reset role;
select pg_temp.dogrula((select sum(miktar) = 3000 from malzeme_hareketleri where malzeme_id = :'sut'), 'elle girilen süt stoğa girmedi');
select pg_temp.dogrula((select sum(miktar) = 1000 from malzeme_hareketleri where malzeme_id = :'kahve'), 'elle girilen kahve stoğa girmedi');
select pg_temp.dogrula((select fiyat = 42.42 and fiyat_haric = 42 from malzemeler where id = :'sut'), 'normal fiyat güncellenmedi');
select pg_temp.dogrula((select fiyat_haric = 1000 from malzemeler where id = :'kahve'), 'sapan fiyat malzemeyi değiştirdi');
select pg_temp.dogrula((select uyarilar = array['fiyat_kontrol'] from giris_kalemleri where giris_id = :'e2'), 'sapan fiyat işaretlenmedi');
select pg_temp.dogrula((select tur = 'fatura' and aciklama = 'Elle giriş · Market' and giren_ad = 'Bulut' from girisler where id = :'e1'),
  'elle giriş kaydı doğru değil');
select pg_temp.dogrula((select count(*) = 3 from islem_gecmisi where mekan_id = :'mekan_gk' and tur = 'giris'), 'elle girişler geçmişe yazılmadı');
set role authenticated;

-- ================================================================================================
-- 2) GÜNLÜK KONTROL (patron) ve yetki
-- ================================================================================================
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000002','baristaGK@x.com');
select pg_temp.hata_bekle($$select public.gunluk_kontrol()$$, 'yalnız patrona');
select pg_temp.hata_bekle($$select public.fiyat_degisimleri()$$, 'yalnız patrona');
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000001','patronGK@x.com');
select pg_temp.dogrula((select (k ->> 'elle_giris_7gun')::int = 3 and jsonb_array_length(k -> 'elle_fiyat_kontrol') = 1
  and k -> 'elle_fiyat_kontrol' -> 0 ->> 'malzeme' = 'Kahve' and (k ->> 'acik_teslimat')::int = 0 and k ->> 'son_sayim' is null
  from public.gunluk_kontrol() k), 'günlük kontrol doğru değil');
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000003','patronGQ@x.com');
select pg_temp.dogrula((select (k ->> 'elle_giris_7gun')::int = 0 and jsonb_array_length(k -> 'elle_fiyat_kontrol') = 0
  from public.gunluk_kontrol() k), 'başka mekanın günlük kontrolüne veri sızdı');

-- ================================================================================================
-- 3) FİYAT DEĞİŞİMİ: veri yokken TL etkisi uydurulmaz; satış varken %5 + 250 TL kuralı
-- ================================================================================================
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000001','patronGK@x.com');
-- Süt: önce 40,40 (başlangıç fiyatı fatura değil), sonra 42,42 (elle fiş) → fatura fiyatı tek: listede yok
select pg_temp.dogrula((select jsonb_array_length(public.fiyat_degisimleri()) = 0), 'tek fatura fiyatıyla değişim gösterildi');
-- İkinci fiş: 2 L × 44 hariç = 88,88 dahil → 42,42 → 44,44 (%4,8) ...
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000002','baristaGK@x.com');
select public.elle_mal_kabul('41414141-0000-0000-0000-000000000004', null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 2000, 'tutar', 88.88)));
-- ... üçüncü fiş: 2 L × 48 hariç = 96,96 dahil → 44,44 → 48,48 (%9,1)
select public.elle_mal_kabul('41414141-0000-0000-0000-000000000005', null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 2000, 'tutar', 96.96)));
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000001','patronGK@x.com');
-- Satış raporu yok → aylık etki null, uyarı yok (yüzde görünür)
select pg_temp.dogrula((select x ->> 'ad' = 'Süt' and (x ->> 'son')::numeric = 48.48 and (x ->> 'onceki')::numeric = 44.44
  and (x ->> 'degisim_yuzde')::numeric = 9.1 and x ->> 'aylik_etki' is null and not (x ->> 'uyari')::boolean
  and (x ->> 'ortalama')::numeric = 45.11
  from jsonb_array_elements(public.fiyat_degisimleri()) x), 'veri yokken fiyat değişimi doğru değil');
-- Satış: günde 400 Latte gibi büyük kullanım → 28 günde 2.000 adet × 200 ml = 400 L → ayda ~429 L × 4,04 = ~1.731 TL
select public.giris_kaydet_tek(gen_random_uuid(), 'satis', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('urun_id', :'latte', 'miktar', 2000)));
select pg_temp.dogrula((select (x ->> 'uyari')::boolean and (x ->> 'aylik_etki')::numeric between 1700 and 1760
  from jsonb_array_elements(public.fiyat_degisimleri()) x), 'büyük etkili zam uyarı vermedi');
-- Barista durumu: sayım sonrası
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 1000)));
select pg_temp.ol('f3f3f3f3-0000-0000-0000-000000000002','baristaGK@x.com');
select pg_temp.dogrula((public.barista_durumu() ->> 'son_sayim')::date = public.bugun(), 'barista son sayımı görmüyor');

reset role;
select 'gunluk_kontrol_test: TAMAM' as sonuc;
