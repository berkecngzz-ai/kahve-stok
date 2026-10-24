-- 25_satis_yalniz_rapor.sql testleri: elle satış kapalı; patron raporu kendi işler; kasa adı eşleşmesi hatırlanır;
-- barista ve başka mekan işleyemez; kurulum eski yoldan işlemeye devam eder.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('f5f5f5f5-0000-0000-0000-000000000001','patronSR@x.com'),
 ('f5f5f5f5-0000-0000-0000-000000000002','baristaSR@x.com'),
 ('f5f5f5f5-0000-0000-0000-000000000003','patronSQ@x.com'),
 ('f5f5f5f5-0000-0000-0000-000000000009','kurulumSR@x.com');
insert into public.kurulum_hesaplari (user_id) values ('f5f5f5f5-0000-0000-0000-000000000009');

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

-- ===== Kafe SR: Latte tarifi, Su (tarifsiz) =====
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000001','patronSR@x.com');
select public.mekan_olustur('Kafe SR','Selin');
select id as mekan, davet_kodu as kod from mekanlar where ad = 'Kafe SR' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40), ('Kahve','g',1000);
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'mekan' \gset
select id as kahve from malzemeler where ad = 'Kahve' and mekan_id = :'mekan' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18), jsonb_build_object('malzeme_id', :'sut', 'miktar', 200))) as latte \gset
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000002','baristaSR@x.com');
select public.mekana_katil(:'kod','Sarp');

-- ===== Başka mekan (izolasyon) =====
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000003','patronSQ@x.com');
select public.mekan_olustur('Kafe SQ','Kaan');
select id as mekan_q from mekanlar where ad = 'Kafe SQ' \gset
insert into malzemeler (ad, birim, fiyat) values ('Çay','g',300);
select id as cay from malzemeler where ad = 'Çay' and mekan_id = :'mekan_q' \gset
select public.urun_kaydet(null, 'Çay', jsonb_build_array(jsonb_build_object('malzeme_id', :'cay', 'miktar', 5))) as cay_urun \gset

-- 1) Elle satış kapalı (giris_kaydet ve giris_kaydet_tek); fire / sayım eskisi gibi
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000001','patronSR@x.com');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('satis', public.bugun(), null, '[{"urun_id":"%s","miktar":3}]')$$, :'latte'),
  'Satış elle girilmez');
select pg_temp.hata_bekle(format($$select public.giris_kaydet_tek(gen_random_uuid(), 'satis', public.bugun(), null, '[{"urun_id":"%s","miktar":3}]')$$, :'latte'),
  'Satış elle girilmez');
select public.giris_kaydet('fire', public.bugun(), 'Döküldü', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 100))) as fire1 \gset

-- 2) Barista raporu yükler (dosya) ama işleyemez; patron işler
reset role;
insert into storage.objects (bucket_id, name) values
  ('fatura-belgeleri', :'mekan' || '/s1/rapor.xlsx'), ('fatura-belgeleri', :'mekan' || '/s2/rapor.csv');
set role authenticated;
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000002','baristaSR@x.com');
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
  'dosyalar', jsonb_build_array(:'mekan' || '/s1/rapor.xlsx'))) ->> 'id' as rapor1 \gset
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":5}]')$$,
  :'rapor1', :'latte'), 'yalnız patron');

-- Başka mekanın patronu işleyemez
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000003','patronSQ@x.com');
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":5}]')$$,
  :'rapor1', :'cay_urun'), 'Satış raporu bulunamadı');

-- Patron başka mekanın ürününü yazamaz, eşleşmede de yazamaz
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000001','patronSR@x.com');
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":5}]')$$,
  :'rapor1', :'cay_urun'), 'bu mekana ait olmayan');
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":5}]',
  '[{"ad":"cay","urun_id":"%s"}]')$$, :'rapor1', :'latte', :'cay_urun'), 'Eşleşmede bu mekana ait olmayan');
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(%L, public.bugun(), '[]')$$, :'rapor1'), 'menüdeki ürünlerden hiçbiri');

-- Patron işler: 10 Latte; "latte (b)" → Latte, "su 0.5" → tarifi yok hatırlanır
select public.satis_raporu_isle(:'rapor1', public.bugun() - 1,
  jsonb_build_array(jsonb_build_object('urun_id', :'latte', 'miktar', 10)),
  jsonb_build_array(jsonb_build_object('ad', 'Latte (B)', 'urun_id', :'latte'), jsonb_build_object('ad', 'su 0.5', 'urun_id', null))) as satis1 \gset
reset role;
select pg_temp.dogrula((select durum = 'tamam' and giris_id = :'satis1' from belgeler where id = :'rapor1'), 'rapor tamam olmadı');
select pg_temp.dogrula((select tur = 'satis' and giren_ad = 'Selin' and tarih = public.bugun() - 1 from girisler where id = :'satis1'),
  'satış girişi yanlış');
select pg_temp.dogrula((select sum(miktar) = 2000 from malzeme_hareketleri where giris_id = :'satis1' and malzeme_id = :'sut'),
  'tarif stoktan düşmedi');
select pg_temp.dogrula((select count(*) = 2 from satis_eslesmeleri where mekan_id = :'mekan'), 'eşleşmeler hatırlanmadı');
select pg_temp.dogrula((select urun_id = :'latte' from satis_eslesmeleri where mekan_id = :'mekan' and ad_anahtar = 'latte (b)'),
  'kasa adı küçük harfle saklanmadı');
select pg_temp.dogrula((select urun_id is null from satis_eslesmeleri where mekan_id = :'mekan' and ad_anahtar = 'su 0.5'),
  'tarifi yok eşleşmesi saklanmadı');
set role authenticated;

-- Aynı rapor ikinci kez işlenmez
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000001','patronSR@x.com');
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":5}]')$$,
  :'rapor1', :'latte'), 'zaten işlenmiş');

-- 3) Eşleşmeleri yalnız patron görür; barista ve başka mekan göremez
select count(*) as gor_patron from satis_eslesmeleri \gset
select pg_temp.dogrula(:'gor_patron'::int = 2, 'patron eşleşmeleri göremiyor');
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000002','baristaSR@x.com');
select count(*) as gor_barista from satis_eslesmeleri \gset
select pg_temp.dogrula(:'gor_barista'::int = 0, 'barista eşleşmeleri görmemeli');
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000003','patronSQ@x.com');
select count(*) as gor_q from satis_eslesmeleri \gset
select pg_temp.dogrula(:'gor_q'::int = 0, 'başka mekan eşleşmeleri görmemeli');
select pg_temp.hata_bekle($$insert into satis_eslesmeleri (mekan_id, ad_anahtar) values (public.benim_mekanim(), 'x')$$, 'permission denied');

-- 4) Kurulum eski işlevle işlemeye devam eder; aynı güne ikinci satış reddedilir
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000001','patronSR@x.com');
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
  'dosyalar', jsonb_build_array(:'mekan' || '/s2/rapor.csv'))) ->> 'id' as rapor2 \gset
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000009','kurulumSR@x.com');
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun() - 1, '[{"urun_id":"%s","miktar":5}]')$$,
  :'rapor2', :'latte'), 'satış zaten girilmiş');
select public.kurulum_satis_raporu_isle(:'rapor2', public.bugun(), jsonb_build_array(jsonb_build_object('urun_id', :'latte', 'miktar', 4))) as satis2 \gset
reset role;
select pg_temp.dogrula((select durum = 'tamam' from belgeler where id = :'rapor2'), 'kurulum raporu işleyemedi');
set role authenticated;

-- 5) Rapordan gelen satış iptal edilebilir (patron)
select pg_temp.ol('f5f5f5f5-0000-0000-0000-000000000001','patronSR@x.com');
select public.giris_iptal(:'satis2');
reset role;
select pg_temp.dogrula((select iptal_zamani is not null from girisler where id = :'satis2'), 'rapor satışı iptal edilemedi');
