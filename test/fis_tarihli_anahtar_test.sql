-- 40_fis_tarihli_anahtar.sql: fiş numarası her gün baştan başlayan kasa. Ertesi günün aynı numaralı fişi ayrı satıştır;
-- aynı gün aynı rapor ikinci kez yüklenirse yine bir kez sayılır. Eski biçimdeki anahtar taşınır.
\set ON_ERROR_STOP 1
insert into auth.users values ('d1d1d1d1-0000-0000-0000-000000000001','patronFT@x.com');
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
create or replace function pg_temp.frapor(mekan uuid) returns uuid language plpgsql as $$
declare v_yol text := mekan || '/' || gen_random_uuid() || '/rapor.csv';
begin
  execute 'reset role';
  insert into storage.objects (bucket_id, name) values ('fatura-belgeleri', v_yol);
  execute 'set role authenticated';
  return (public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
    'dosyalar', jsonb_build_array(v_yol))) ->> 'id')::uuid;
end $$;
create or replace function pg_temp.fsatir(tarih date, fis text, urun uuid, adet int, tur text default 'satis') returns jsonb language sql as $$
  select jsonb_build_object('tarih', tarih, 'fis_no', fis, 'ad', 'Latte', 'ad_anahtar', 'latte', 'urun_id', urun, 'adet', adet, 'tur', tur) $$;
create or replace function pg_temp.fsut(m uuid, t date) returns numeric language sql as $$
  select coalesce(sum(h.miktar), 0) from malzeme_hareketleri h join girisler g on g.id = h.giris_id
  where g.mekan_id = m and g.tur = 'satis' and g.tarih = t and g.iptal_zamani is null $$;

set role authenticated;
select pg_temp.ol('d1d1d1d1-0000-0000-0000-000000000001','patronFT@x.com');
select public.mekan_olustur('Kafe FT','Su');
select id as ma from mekanlar where ad = 'Kafe FT' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40);
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = :'ma'), 'miktar', 200))) as latte \gset

-- 1) Dün fiş 1–2, bugün yine fiş 1–2 (kasa her gün baştan): bugünkü satırlar mükerrer SAYILMAZ
select public.satis_raporu_isle(pg_temp.frapor(:'ma'), jsonb_build_array(
  pg_temp.fsatir(public.bugun() - 1, '1'::text, :'latte'::uuid, 2), pg_temp.fsatir(public.bugun() - 1, '2'::text, :'latte'::uuid, 1))) as r1 \gset
select public.satis_raporu_isle(pg_temp.frapor(:'ma'), jsonb_build_array(
  pg_temp.fsatir(public.bugun(), '1'::text, :'latte'::uuid, 3), pg_temp.fsatir(public.bugun(), '2'::text, :'latte'::uuid, 1))) as r2 \gset
select pg_temp.dogrula((:'r2'::jsonb ->> 'eklenen')::int = 2 and (:'r2'::jsonb ->> 'mukerrer')::int = 0,
  'ertesi günün aynı numaralı fişleri atıldı: ' || :'r2');
select pg_temp.dogrula(pg_temp.fsut(:'ma', public.bugun()) = 800 and pg_temp.fsut(:'ma', public.bugun() - 1) = 600,
  'günlük süt tüketimi yanlış: bugün ' || pg_temp.fsut(:'ma', public.bugun()) || ', dün ' || pg_temp.fsut(:'ma', public.bugun() - 1));

-- 2) Aynı günün raporu ikinci kez: hepsi mükerrer, tüketim değişmez
select public.satis_raporu_isle(pg_temp.frapor(:'ma'), jsonb_build_array(
  pg_temp.fsatir(public.bugun(), '1'::text, :'latte'::uuid, 3), pg_temp.fsatir(public.bugun(), '2'::text, :'latte'::uuid, 1))) as r3 \gset
select pg_temp.dogrula((:'r3'::jsonb ->> 'eklenen')::int = 0 and (:'r3'::jsonb ->> 'mukerrer')::int = 2, 'aynı rapor iki kez sayıldı: ' || :'r3');
select pg_temp.dogrula(pg_temp.fsut(:'ma', public.bugun()) = 800, 'ikinci yükleme tüketimi değiştirdi');

-- 3) İptal aynı gün aynı fişe düşer (net 3 − 1 = 2 Latte = 400 ml), dünkü fiş 1'i etkilemez
select public.satis_raporu_isle(pg_temp.frapor(:'ma'), jsonb_build_array(pg_temp.fsatir(public.bugun(), '1'::text, :'latte'::uuid, 1, 'iptal')));
select pg_temp.dogrula(pg_temp.fsut(:'ma', public.bugun()) = 600 and pg_temp.fsut(:'ma', public.bugun() - 1) = 600,
  'iptal yanlış güne/fişe düştü: bugün ' || pg_temp.fsut(:'ma', public.bugun()));

-- 4) Taşıma: eski biçim anahtar ('F|fiş|ürün|tür') yeni biçime geçer; eski raporun tekrarı yine mükerrer
reset role;
insert into satis_satirlari (mekan_id, anahtar, grup, fis_no, tarih, ad, ad_anahtar, adet, tur)
  values (:'ma', 'F|99|latte|satis', 'F|99|latte', '99', public.bugun() - 3, 'Latte', 'latte', 1, 'satis');
update public.satis_satirlari
   set grup = 'F|' || to_char(tarih, 'YYYY-MM-DD') || '|' || fis_no || '|' || ad_anahtar,
       anahtar = 'F|' || to_char(tarih, 'YYYY-MM-DD') || '|' || fis_no || '|' || ad_anahtar || '|' || tur
 where fis_no is not null and anahtar = 'F|' || fis_no || '|' || ad_anahtar || '|' || tur;
select pg_temp.dogrula((select anahtar from satis_satirlari where mekan_id = :'ma' and fis_no = '99')
  = 'F|' || to_char(public.bugun() - 3, 'YYYY-MM-DD') || '|99|latte|satis', 'eski anahtar taşınmadı');
set role authenticated;
select pg_temp.ol('d1d1d1d1-0000-0000-0000-000000000001','patronFT@x.com');
select public.satis_raporu_isle(pg_temp.frapor(:'ma'), jsonb_build_array(pg_temp.fsatir(public.bugun() - 3, '99'::text, :'latte'::uuid, 1))) as r4 \gset
select pg_temp.dogrula((:'r4'::jsonb ->> 'mukerrer')::int = 1, 'taşınan eski satır tekrar sayıldı: ' || :'r4');
reset role;
