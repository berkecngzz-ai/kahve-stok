-- Adım 4 / Parça 1: KDV'li fatura, toplam kontrolü, belgeler, KDV gösterim ayarı. Her test başarısızsa hata fırlatır.
-- Sıra: ... 03, girisler_test, 04, bu dosya.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('aaaaaaaa-0000-0000-0000-000000000001','patronG@x.com'),
 ('aaaaaaaa-0000-0000-0000-000000000002','baristaG@x.com'),
 ('aaaaaaaa-0000-0000-0000-000000000003','patronH@x.com');

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

-- Eski kayıtlar değişmedi: Kafe E'nin sütü 45 TL, KDV oranı bilinmiyor
select pg_temp.dogrula((select fiyat = 45 and fiyat_haric is null and kdv_orani is null
  from malzemeler m join mekanlar k on k.id = m.mekan_id where k.ad = 'Kafe E' and m.ad = 'Süt'), 'eski fiyat bozuldu');
select pg_temp.dogrula((select count(*) = 0 from giris_kalemleri where kdv_orani is not null), 'eski satırlara oran yazıldı');

set role authenticated;

-- Patron G: mekan + malzemeler
select pg_temp.ol('aaaaaaaa-0000-0000-0000-000000000001','patronG@x.com');
select public.mekan_olustur('Kafe G','Gül');
select id as mekan_g, davet_kodu as kod_g from mekanlar \gset
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Süt','ml',40,1);
insert into malzemeler (ad, birim, fiyat) values ('Kahve','g',1000);   -- eski usul: oran yok
select id as sut from malzemeler where ad = 'Süt' \gset
select id as kahve from malzemeler where ad = 'Kahve' \gset
select pg_temp.dogrula((select fiyat from malzemeler where id = :'sut') = 40.40, 'KDV dahil fiyat hesaplanmadı');
select pg_temp.dogrula((select fiyat = 1000 and fiyat_haric is null from malzemeler where id = :'kahve'), 'oransız fiyat bozuldu');
-- Eski ekran yalnız KDV dahil fiyatı değiştirirse hariç fiyat ondan hesaplanır
update malzemeler set fiyat = 50.50 where id = :'sut';
select pg_temp.dogrula((select fiyat = 50.50 and fiyat_haric = 50 and kdv_orani = 1 from malzemeler where id = :'sut'),
  'eski ekrandan fiyat değişikliği kayboldu');
select pg_temp.dogrula((select fiyat_haric = 50 and kdv_orani = 1 from fiyat_gecmisi where malzeme_id = :'sut'
  order by id desc limit 1), 'fiyat geçmişine KDV yazılmadı');
select pg_temp.hata_bekle(format($$update malzemeler set kdv_orani = 150 where id = %L$$, :'sut'), 'check');

-- KDV gösterim ayarı: varsayılan dahil; yalnız patron değiştirir
select pg_temp.dogrula((select kdv_gosterim from mekanlar) = 'dahil', 'varsayılan KDV dahil değil');
select public.kdv_gosterim_ayarla('haric');
select pg_temp.dogrula((select kdv_gosterim from mekanlar) = 'haric', 'ayar kaydedilmedi');
select pg_temp.hata_bekle($$select public.kdv_gosterim_ayarla('yarim')$$, 'Geçersiz seçim');
select pg_temp.hata_bekle($$update mekanlar set kdv_gosterim = 'dahil'$$, 'permission denied');

-- Barista G katılır, belgeyi kendi mekanının klasörüne yükler; başka klasöre yükleyemez
select pg_temp.ol('aaaaaaaa-0000-0000-0000-000000000002','baristaG@x.com');
select public.mekana_katil(:'kod_g','Gökay');
select pg_temp.hata_bekle($$select public.kdv_gosterim_ayarla('dahil')$$, 'yalnızca patron');
insert into storage.objects (bucket_id, name) values
  ('fatura-belgeleri', :'mekan_g' || '/t1/1.jpg'), ('fatura-belgeleri', :'mekan_g' || '/t1/2.pdf'),
  ('fatura-belgeleri', :'mekan_g' || '/t2/1.jpg');
select pg_temp.hata_bekle($$insert into storage.objects (bucket_id, name) values
  ('fatura-belgeleri', '00000000-0000-0000-0000-000000000000/x/1.jpg')$$, 'row-level security');
select pg_temp.hata_bekle(format($$insert into storage.objects (bucket_id, name) values ('baska-kova', '%s/x.jpg')$$,
  :'mekan_g'), 'row-level security');

-- Doğru fatura: süt 24 lt, 1.188,12 + %1 = 1.200,00 · deterjan (stok dışı) 100 + %20 = 120 · genel 1.320
select public.fatura_kaydet(public.bugun(), 'Metro', jsonb_build_array(
    jsonb_build_object('malzeme_id', :'sut', 'miktar', 24000, 'tutar_kdv_haric', 1188.12, 'kdv_orani', 1,
                       'uyarilar', jsonb_build_array('fiyat')),
    jsonb_build_object('stok_disi', true, 'satir_metni', 'Deterjan', 'tutar_kdv_haric', 100, 'kdv_orani', 20)),
  '{"genel": 1320, "kdv_haric": 1288.12, "kdv": 31.88, "indirim": 0}',
  jsonb_build_array(:'mekan_g' || '/t1/1.jpg', :'mekan_g' || '/t1/2.pdf')) as fatura1 \gset

select pg_temp.dogrula((select belge_genel_toplam = 1320 and belge_kdv_haric_toplam = 1288.12 and belge_kdv_toplam = 31.88
  from girisler where id = :'fatura1'), 'alt toplamlar kaydedilmedi');
select pg_temp.dogrula((select count(*) = 2 from giris_kalemleri where giris_id = :'fatura1'), 'satırlar kaydedilmedi');
select pg_temp.dogrula((select tutar = 1200 and tutar_kdv_haric = 1188.12 and kdv_orani = 1 and uyarilar = '{fiyat}'
  from giris_kalemleri where giris_id = :'fatura1' and malzeme_id = :'sut'), 'süt satırı yanlış');
select pg_temp.dogrula((select tutar = 120 and stok_disi from giris_kalemleri where giris_id = :'fatura1' and satir_metni = 'Deterjan'),
  'stok dışı satır yanlış');
select pg_temp.dogrula((select count(*) = 1 and sum(miktar) = 24000 from malzeme_hareketleri where giris_id = :'fatura1'),
  'stok dışı satır stoğa eklendi ya da süt eklenmedi');
select pg_temp.dogrula((select fiyat = 50.00 and fiyat_haric = 49.505 and kdv_orani = 1 from malzemeler where id = :'sut'),
  'faturadan gelen fiyat yanlış');
select pg_temp.dogrula((select count(*) = 2 from giris_belgeleri where giris_id = :'fatura1'), 'belgeler bağlanmadı');
select pg_temp.dogrula((select tur from giris_belgeleri where yol like '%.pdf') = 'pdf', 'PDF türü yanlış');
select pg_temp.dogrula((select fatura_sayisi = 1 and medyan_miktar = 24000 and son_kdv_orani = 1
  from public.fatura_referanslari() where malzeme_id = :'sut'), 'fatura referansı yanlış');

-- 1 TL'ye kadar kuruş farkı kabul edilir
select public.fatura_kaydet(public.bugun(), null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 1000, 'tutar_kdv_haric', 1000, 'kdv_orani', 1)),
  '{"genel": 1010.60}', null) as fatura2 \gset

-- TUTMAYAN FATURALAR KAYDEDİLMEZ
select count(*) as onceki from girisler \gset
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1000,"tutar_kdv_haric":1000,"kdv_orani":1}]', '{"genel": 1110}', null)$$, :'kahve'),
  'Fark: 100,00 TL');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1000,"tutar_kdv_haric":1000,"kdv_orani":1}]', '{"genel": 1010, "kdv_haric": 900}', null)$$, :'kahve'),
  'KDV hariç toplam');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1000,"tutar_kdv_haric":1000,"kdv_orani":1}]', '{"genel": 1010, "kdv": 200}', null)$$, :'kahve'),
  'KDV oranlarını kontrol et');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1000,"tutar_kdv_haric":1000,"kdv_orani":1}]',
  '{"genel": 1009, "kdv_haric": 1001, "kdv": 11, "indirim": 0}', null)$$, :'kahve'), 'birbirini tutmuyor');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1000,"tutar_kdv_haric":1000,"kdv_orani":1}]', '{}', null)$$, :'kahve'), 'genel toplamını');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1000,"tutar_kdv_haric":1000}]', '{"genel": 1000}', null)$$, :'kahve'), 'KDV oranını seç');
select pg_temp.hata_bekle($$select public.fatura_kaydet(public.bugun(), null,
  '[{"stok_disi":true,"tutar_kdv_haric":10,"kdv_orani":20}]', '{"genel": 12}', null)$$, 'ne olduğunu yaz');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1},{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1}]',
  '{"genel": 2.02}', null)$$, :'kahve', :'kahve'), 'iki satırda');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun() + 1, null,
  '[{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1}]', '{"genel": 1.01}', null)$$, :'kahve'), 'ileri olamaz');
-- Belge kuralları
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1}]', '{"genel": 1.01}', '["%s/t1/1.jpg"]')$$,
  :'kahve', :'mekan_g'), 'başka bir faturaya');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1}]', '{"genel": 1.01}', '["%s/yok/1.jpg"]')$$,
  :'kahve', :'mekan_g'), 'Belge bulunamadı');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1}]', '{"genel": 1.01}',
  '["a","b","c","d","e","f"]')$$, :'kahve'), 'en fazla 5');
select pg_temp.dogrula((select count(*) from girisler) = :onceki, 'hatalı faturalardan biri kaydedildi');

-- Eski fatura girişi kapalı; satış/fire/sayım çalışmaya devam eder
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fatura', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1,"tutar":1}]')$$, :'kahve'), 'Sayfayı yenile');
select public.giris_kaydet('sayim', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 1000)));

-- Barista kendi faturasını iptal eder → süt fiyatı elle girilen 50,50'ye (hariç 50, %1) döner
select public.giris_iptal(:'fatura1');
select pg_temp.dogrula((select fiyat = 50.50 and fiyat_haric = 50 and kdv_orani = 1 from malzemeler where id = :'sut'),
  'iptal sonrası KDV''li fiyat geri dönmedi');
select pg_temp.dogrula((select count(*) = 2 from giris_belgeleri where giris_id = :'fatura1'), 'iptal belgeleri sildi');

-- Doğrudan yazma/silme yok
select pg_temp.hata_bekle(format($$insert into giris_belgeleri (giris_id, mekan_id, yol, tur) values (%L, %L, 'x', 'foto')$$,
  :'fatura1', :'mekan_g'), 'permission denied');
select pg_temp.hata_bekle($$delete from giris_belgeleri$$, 'permission denied');
delete from storage.objects;                      -- silme kuralı yok: hiçbir dosya silinmemeli
update storage.objects set name = 'x';            -- değiştirme kuralı yok
select pg_temp.hata_bekle($$select public.giris_kaydet_v1('sayim', public.bugun(), null, '[]')$$, 'permission denied');

-- Patron H: G'nin hiçbir şeyini görmez, kullanamaz
select pg_temp.ol('aaaaaaaa-0000-0000-0000-000000000003','patronH@x.com');
select public.mekan_olustur('Kafe H','Hale');
select pg_temp.dogrula((select count(*) = 0 from giris_belgeleri), 'H, G''nin belgelerini görüyor');
select pg_temp.dogrula((select count(*) = 0 from storage.objects), 'H, G''nin dosyalarını görüyor');
select pg_temp.dogrula((select count(*) = 0 from public.fatura_referanslari()), 'H, G''nin fatura referanslarını görüyor');
select pg_temp.dogrula((select kdv_gosterim from mekanlar) = 'dahil', 'G''nin ayarı H''yi etkiledi');
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1}]', '{"genel": 1.01}', null)$$, :'sut'), 'geçersiz bir malzeme');
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Süt','ml',30,1);
select id as sut_h from malzemeler \gset
select pg_temp.hata_bekle(format($$select public.fatura_kaydet(public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1,"tutar_kdv_haric":1,"kdv_orani":1}]', '{"genel": 1.01}', '["%s/t2/1.jpg"]')$$,
  :'sut_h', :'mekan_g'), 'Belge bulunamadı');

reset role;
select pg_temp.dogrula((select count(*) = 3 from storage.objects), 'dosyalar silindi ya da eksik');
select pg_temp.dogrula((select count(*) = 0 from storage.objects where name = 'x'), 'dosya adı değiştirildi');
set role anon;
select pg_temp.hata_bekle($$select * from giris_belgeleri$$, 'permission denied');
select pg_temp.hata_bekle($$select public.fatura_kaydet(current_date, null, '[]', '{}', null)$$, 'permission denied');
select pg_temp.hata_bekle($$select public.kdv_gosterim_ayarla('haric')$$, 'permission denied');
select pg_temp.hata_bekle($$select public.fatura_referanslari()$$, 'permission denied');
reset role;
\echo 'TUM FATURA/KDV TESTLERI GECTI'
