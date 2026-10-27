-- 33_icerik_mukerrer.sql: aynı fatura PDF ve fotoğraf olarak iki kez stoğa girmez (başlık farklı okunsa da).
\set ON_ERROR_STOP 1
insert into auth.users values
 ('e5e5e5e5-0000-0000-0000-000000000001','patronIM@x.com'),
 ('e5e5e5e5-0000-0000-0000-000000000002','baristaIM@x.com');
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
create or replace function pg_temp.hata_bekle(q text, beklenen text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm not like '%' || beklenen || '%' then raise exception 'Beklenmeyen hata: % (sorgu: %)', sqlerrm, q; end if;
    return;
  end;
  raise exception 'Hata bekleniyordu ama olmadı: %', q;
end $$;
-- Kahve 1 kg 600 TL + süt 2 L 80 TL (KDV dahil), genel 680
create or replace function pg_temp.fatura(ozet text, kaynak text, ted text, no text, tarih date, kahve uuid, sut uuid,
  onay boolean default false, kahve_tl numeric default 600) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', kaynak, 'dosya_ozeti', ozet, 'tedarikci', ted, 'fatura_no', no,
    'tarih', tarih, 'toplamlar', jsonb_build_object('genel', kahve_tl + 80), 'ayni_olabilir_onay', onay,
    'okunan', jsonb_build_object('not', 'test'), 'satirlar', jsonb_build_array(
      jsonb_build_object('metin', 'TEST Kahve', 'miktar', 1, 'birim', 'kg', 'tutar_dahil', kahve_tl, 'sinif', 'eslesti',
        'malzeme_id', kahve, 'carpan', 1000, 'barista_onayi', true, 'gelen_miktar', 1, 'sayim', 'sayildi', 'teslimat', 'tam'),
      jsonb_build_object('metin', 'TEST Süt', 'miktar', 2, 'birim', 'lt', 'tutar_dahil', 80, 'sinif', 'eslesti',
        'malzeme_id', sut, 'carpan', 1000, 'barista_onayi', true, 'gelen_miktar', 2, 'sayim', 'sayildi', 'teslimat', 'tam')))) $$;

set role authenticated;
select pg_temp.ol('e5e5e5e5-0000-0000-0000-000000000001','patronIM@x.com');
select public.mekan_olustur('Kafe IM','Berke');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe IM' \gset
insert into malzemeler (ad, birim, fiyat) values ('Kahve','g',600), ('Süt','ml',40);
select id as kahve from malzemeler where ad = 'Kahve' and mekan_id = :'ma' \gset
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'ma' \gset
select pg_temp.ol('e5e5e5e5-0000-0000-0000-000000000002','baristaIM@x.com');
select public.mekana_katil(:'kod','Selen');

-- 1) PDF: tedarikçi boş, numara kesik okundu → kaydedilir
select pg_temp.fatura(repeat('1', 64), 'pdf', null, 'TEST-OCR-20261028-00', public.bugun(), :'kahve', :'sut') as f1 \gset
-- 2) Aynı faturanın fotoğrafı: farklı dosya, tedarikçi ve numara doğru okundu → içerik izi yakalar
select pg_temp.hata_bekle(format($$select pg_temp.fatura(%L, 'ai', 'TEST TEDARİKÇİ', 'TEST-OCR-20261028-001', public.bugun(), %L, %L)$$,
  repeat('2', 64), :'kahve', :'sut'), 'daha önce yüklenmiş olabilir');
reset role;
select pg_temp.dogrula((select count(*) from belgeler where mekan_id = :'ma' and iptal_zamani is null) = 1, 'mükerrer fatura kaydedildi');
select pg_temp.dogrula((select sum(h.miktar) from malzeme_hareketleri h join girisler g on g.id = h.giris_id
  where g.mekan_id = :'ma' and g.tur = 'fatura' and h.malzeme_id = :'kahve') = 1000, 'kahve iki kez stoğa girdi');
set role authenticated;
-- 3) Barista "Hayır, farklı fatura" derse kaydedilir
select pg_temp.fatura(repeat('3', 64), 'ai', 'TEST TEDARİKÇİ', 'TEST-OCR-20261028-002', public.bugun(), :'kahve', :'sut', true) as f3 \gset
-- 4) Aynı tutarlar başka gün (her hafta aynı sipariş) → sorulmadan kaydedilir
select pg_temp.fatura(repeat('4', 64), 'ai', 'TEST TEDARİKÇİ', 'TEST-OCR-20261027-001', public.bugun() - 1, :'kahve', :'sut') as f4 \gset
-- 5) Aynı gün, aynı genel toplam ama satır tutarları farklı → farklı fatura, kaydedilir
select public.belge_kaydet(jsonb_build_object(
    'istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'dosya_ozeti', repeat('5', 64), 'tedarikci', 'BAŞKA',
    'tarih', public.bugun(), 'toplamlar', jsonb_build_object('genel', 680), 'okunan', jsonb_build_object('not', 'test'),
    'satirlar', jsonb_build_array(jsonb_build_object('metin', 'TEST Kahve', 'miktar', 1, 'birim', 'kg', 'tutar_dahil', 680,
      'sinif', 'eslesti', 'malzeme_id', :'kahve', 'carpan', 1000, 'barista_onayi', true, 'gelen_miktar', 1, 'sayim', 'sayildi', 'teslimat', 'tam')))) as f5 \gset
reset role;
select pg_temp.dogrula((select count(*) from belgeler where mekan_id = :'ma' and iptal_zamani is null) = 4, 'farklı faturalar engellendi');
