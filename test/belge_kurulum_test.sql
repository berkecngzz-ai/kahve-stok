-- Adım 4 / Parça 2: fiyat gizliliği, belge kaydetme, çift kayıt, kurulum kuyruğu, geri al. Her test başarısızsa hata fırlatır.
-- Sıra: ... 04, fatura_kdv_test, 05, bu dosya.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('bbbbbbbb-0000-0000-0000-000000000001','patronK@x.com'),
 ('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com'),
 ('bbbbbbbb-0000-0000-0000-000000000003','patronL@x.com'),
 ('bbbbbbbb-0000-0000-0000-000000000009','kurulum@x.com');
insert into public.kurulum_hesaplari (user_id) values ('bbbbbbbb-0000-0000-0000-000000000009');

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
-- Bir belge isteği: satırlar ve alanlar dışarıdan verilir.
create or replace function pg_temp.belge(istek text, ozet text, ettn text, no text, vkn text, genel numeric,
                                         satirlar jsonb, dosyalar jsonb default '[]', onay boolean default false)
returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', istek, 'tur', 'fatura', 'kaynak', 'xml', 'dosya_ozeti', ozet, 'ettn', ettn, 'fatura_no', no,
    'tedarikci', 'Metro Gıda', 'tedarikci_vkn', vkn, 'tarih', public.bugun(),
    'toplamlar', jsonb_build_object('genel', genel), 'okunan', jsonb_build_object('not', 'test'),
    'dosyalar', dosyalar, 'ayni_olabilir_onay', onay, 'satirlar', satirlar)) $$;

select pg_temp.dogrula(public.metin_anahtari('SÜTAŞ Süt 1L x12, İÇİM!') = 'sutas sut 1l x12 icim', 'metin anahtarı yanlış');

set role authenticated;

-- Kafe K: patron, barista, malzemeler
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000001','patronK@x.com');
select public.mekan_olustur('Kafe K','Kaan');
select id as mekan_k, davet_kodu as kod_k from mekanlar \gset
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Süt','ml',40,1), ('Kahve','g',1000,1);
select id as sut from malzemeler where ad = 'Süt' \gset
select id as kahve from malzemeler where ad = 'Kahve' \gset
-- Deterjan daha önce kurulumca "takip dışı" işaretlenmiş olsun (defter)
reset role;
insert into eslestirme_defteri (mekan_id, metin_anahtar, birim, sonuc, kaynak)
  values (:'mekan_k', 'deterjan 5l', 'adet', 'takip_disi', 'kurulum');
set role authenticated;

-- FİYAT GİZLİLİĞİ: fiyat sütunları kimseye doğrudan açık değil; patron fonksiyonla görür
select pg_temp.hata_bekle($$select fiyat from malzemeler$$, 'permission denied');
select pg_temp.dogrula((select count(*) = 2 and min(fiyat) = 40.40 from public.malzeme_fiyatlari()), 'patron fiyatları göremiyor');
select pg_temp.dogrula((select count(*) = 2 from fiyat_gecmisi), 'patron fiyat geçmişini göremiyor');

select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select public.mekana_katil(:'kod_k','Burak');
select pg_temp.hata_bekle($$select fiyat_haric from malzemeler$$, 'permission denied');
select pg_temp.hata_bekle($$select * from malzemeler$$, 'permission denied');
select pg_temp.dogrula((select count(*) = 2 from (select id, ad, birim from malzemeler) x), 'barista malzeme adlarını göremiyor');
select pg_temp.dogrula((select count(*) = 0 from public.malzeme_fiyatlari()), 'barista fiyatları görüyor');
select pg_temp.dogrula((select count(*) = 0 from fiyat_gecmisi), 'barista fiyat geçmişini görüyor');
select pg_temp.dogrula((select count(*) = 0 from public.fatura_referanslari()), 'barista fatura geçmişi bilgisini görüyor');

-- Barista belgeyi yükler (dosya)
insert into storage.objects (bucket_id, name) values
  ('fatura-belgeleri', :'mekan_k' || '/b1/fatura.xml'), ('fatura-belgeleri', :'mekan_k' || '/b2/1.jpg'),
  ('fatura-belgeleri', :'mekan_k' || '/r1/rapor.jpg');

-- 1) Temiz fatura: süt (barista "Evet") stoğa, deterjan takip dışı. 1188,12 + %1 = 1200 · 100 + %20 = 120 · genel 1320
select pg_temp.belge('11111111-aaaa-0000-0000-000000000001', repeat('a', 64), 'ETTN-1', 'abc2026000001', '1234567890', 1320,
  jsonb_build_array(
    jsonb_build_object('metin', 'SÜTAŞ SÜT 1L', 'miktar', 24, 'birim', 'adet', 'birim_fiyat', 49.505, 'tutar_haric', 1188.12,
                       'kdv_orani', 1, 'sinif', 'eslesti', 'malzeme_id', :'sut', 'carpan', 1000, 'barista_onayi', true),
    jsonb_build_object('metin', 'DETERJAN 5L', 'miktar', 1, 'birim', 'adet', 'tutar_haric', 100, 'kdv_orani', 20, 'sinif', 'takip_disi')),
  jsonb_build_array(:'mekan_k' || '/b1/fatura.xml')) as s1 \gset
select pg_temp.dogrula((:'s1')::jsonb ->> 'durum' = 'tamam' and ((:'s1')::jsonb ->> 'stoklanan')::int = 1
  and ((:'s1')::jsonb ->> 'takip_disi')::int = 1 and ((:'s1')::jsonb ->> 'bekleyen')::int = 0, 'temiz fatura sonucu yanlış: ' || :'s1');
select (:'s1')::jsonb ->> 'id' as belge1 \gset

-- Tekrar deneme (bağlantı koptu): aynı istek → aynı sonuç, ikinci kayıt yok
select pg_temp.belge('11111111-aaaa-0000-0000-000000000001', repeat('a', 64), 'ETTN-1', 'abc2026000001', '1234567890', 1320,
  '[{"metin":"x","miktar":1,"birim":"adet","tutar_haric":1,"kdv_orani":1,"sinif":"takip_disi"}]') as s1b \gset
select pg_temp.dogrula((:'s1b')::jsonb ->> 'id' = :'belge1' and ((:'s1b')::jsonb ->> 'tekrar')::boolean, 'tekrar denemede ikinci kayıt');

-- Kesin çift kayıt: aynı dosya / aynı ETTN / aynı tedarikçi + fatura no
select pg_temp.hata_bekle($$select pg_temp.belge(gen_random_uuid()::text, repeat('a', 64), null, null, null, 1, '[{"metin":"x","sinif":"takip_disi"}]')$$, 'daha önce yüklenmiş (');
select pg_temp.hata_bekle($$select pg_temp.belge(gen_random_uuid()::text, null, 'ETTN-1', null, null, 1, '[{"metin":"x","sinif":"takip_disi"}]')$$, 'daha önce yüklenmiş (');
select pg_temp.hata_bekle($$select pg_temp.belge(gen_random_uuid()::text, null, null, 'ABC2026000001', '1234567890', 1, '[{"metin":"x","sinif":"takip_disi"}]')$$, 'daha önce yüklenmiş (');
-- Olası çift kayıt: aynı tedarikçi + tarih + genel toplam → uyarı; "aynı değil" onayıyla geçer
select pg_temp.hata_bekle($$select pg_temp.belge(gen_random_uuid()::text, null, null, null, '1234567890', 1320, '[{"metin":"x","sinif":"takip_disi"}]')$$, 'yüklenmiş olabilir');

-- PATRON GÖRÜR: süt stoğa girdi, fiyat güncellendi (49,505 hariç → 50,00), deterjan stoğa girmedi
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000001','patronK@x.com');
select pg_temp.dogrula((select count(*) = 1 and sum(miktar) = 24000 from malzeme_hareketleri), 'stok hareketi yanlış');
select pg_temp.dogrula((select fiyat = 50.00 from public.malzeme_fiyatlari() where id = :'sut'), 'faturadan fiyat güncellenmedi');
select pg_temp.dogrula((select count(*) = 1 from eslestirme_defteri where kaynak = 'barista' and metin_anahtar = 'sutas sut 1l'),
  'barista eşleşmesi deftere yazılmadı');
select pg_temp.dogrula((select durum = 'tamam' and toplam_tutuyor and okunan is not null from belgeler where id = :'belge1'), 'belge kaydı yanlış');
select pg_temp.dogrula((select count(*) = 1 from belge_dosyalari where belge_id = :'belge1' and tur = 'xml'), 'XML dosyası bağlanmadı');
select pg_temp.dogrula((select bekleyen_fatura = 0 from public.eksik_belge_ozeti()), 'eksik yokken eksik görünüyor');

-- 2) Defterdeki eşleşme otomatik: aynı tedarikçi, aynı metin → sorusuz stoğa
--    Başka tedarikçiden aynı metin → otomatik değil, bekler · bilinmeyen benzer satır → bekler · başka mekanın malzemesi → bekler
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select pg_temp.belge('11111111-aaaa-0000-0000-000000000002', repeat('b', 64), 'ETTN-2', 'ABC2026000002', '1234567890', 1502.88,
  jsonb_build_array(
    jsonb_build_object('metin', 'Sütaş Süt 1L', 'miktar', 24, 'birim', 'adet', 'birim_fiyat', 49.5, 'tutar_haric', 1188,
                       'kdv_orani', 1, 'sinif', 'eslesti', 'malzeme_id', :'sut', 'carpan', 1000),
    jsonb_build_object('metin', 'ESPRESSO ÇEKİRDEK 1KG', 'miktar', 2, 'birim', 'adet', 'tutar_haric', 200, 'kdv_orani', 1,
                       'sinif', 'belirsiz', 'aday_malzeme_id', :'kahve'),
    jsonb_build_object('metin', 'KAHVE 250G', 'miktar', 1, 'birim', 'adet', 'tutar_haric', 100, 'kdv_orani', 1,
                       'sinif', 'eslesti', 'malzeme_id', :'kahve', 'carpan', 250))) as s2 \gset
select pg_temp.dogrula(((:'s2')::jsonb ->> 'stoklanan')::int = 1 and ((:'s2')::jsonb ->> 'bekleyen')::int = 2
  and (:'s2')::jsonb ->> 'durum' = 'bekliyor', 'defter/belirsiz sonucu yanlış: ' || :'s2');
select (:'s2')::jsonb ->> 'id' as belge2 \gset

-- 3) Toplam tutmuyor: hiçbir satır stoğa girmez (defterde olsa bile)
select pg_temp.belge('11111111-aaaa-0000-0000-000000000003', repeat('c', 64), null, 'X3', '1234567890', 9999,
  jsonb_build_array(jsonb_build_object('metin', 'SÜTAŞ SÜT 1L', 'miktar', 24, 'birim', 'adet', 'tutar_haric', 1188,
                       'kdv_orani', 1, 'sinif', 'eslesti', 'malzeme_id', :'sut', 'carpan', 1000))) as s3 \gset
select pg_temp.dogrula(((:'s3')::jsonb ->> 'stoklanan')::int = 0 and ((:'s3')::jsonb ->> 'bekleyen')::int = 1
  and not ((:'s3')::jsonb ->> 'toplam_tutuyor')::boolean, 'toplamı tutmayan fatura stoğa girdi: ' || :'s3');
select (:'s3')::jsonb ->> 'id' as belge3 \gset

-- 4) Olağandışı fiyat (süt 200 TL/lt) ve satır içi tutarsızlık (10 × 10 ≠ 50) → bekler
select pg_temp.belge('11111111-aaaa-0000-0000-000000000004', repeat('d', 64), null, 'X4', '1234567890', 4898.5,
  jsonb_build_array(
    jsonb_build_object('metin', 'SÜTAŞ SÜT 1L', 'miktar', 24, 'birim', 'adet', 'tutar_haric', 4800, 'kdv_orani', 1,
                       'sinif', 'eslesti', 'malzeme_id', :'sut', 'carpan', 1000),
    jsonb_build_object('metin', 'KAHVE 250G', 'miktar', 10, 'birim', 'adet', 'birim_fiyat', 10, 'tutar_haric', 50,
                       'kdv_orani', 1, 'sinif', 'eslesti', 'malzeme_id', :'kahve', 'carpan', 250, 'barista_onayi', true))) as s4 \gset
select pg_temp.dogrula(((:'s4')::jsonb ->> 'stoklanan')::int = 0 and ((:'s4')::jsonb ->> 'bekleyen')::int = 2,
  'olağandışı satırlar stoğa girdi: ' || :'s4');
select (:'s4')::jsonb ->> 'id' as belge4 \gset

-- Hatalı istekler
select pg_temp.hata_bekle($$select public.belge_kaydet('{"istek_id":"x"}')$$, 'Geçersiz istek');
select pg_temp.hata_bekle($$select pg_temp.belge(gen_random_uuid()::text, null, null, null, null, null, '[{"metin":"x"}]')$$, 'en altındaki toplamı');
select pg_temp.hata_bekle($$select pg_temp.belge(gen_random_uuid()::text, null, null, null, null, 10, '[]')$$, 'okunabilen satır yok');
select pg_temp.hata_bekle(format($$select pg_temp.belge(gen_random_uuid()::text, null, null, null, null, 1,
  '[{"metin":"x","sinif":"takip_disi"}]', '["%s/b1/fatura.xml"]')$$, :'mekan_k'), 'başka bir belgeye bağlı');
select pg_temp.hata_bekle($$select pg_temp.belge(gen_random_uuid()::text, null, null, null, null, 1,
  '[{"metin":"x","sinif":"takip_disi"}]', '["00000000-0000-0000-0000-000000000000/x/1.jpg"]')$$, 'bulunamadı');
select pg_temp.hata_bekle($$select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu',
  'kaynak', 'dosya'))$$, 'Satış raporunun fotoğrafını');

-- Satış raporu (dosyayla) → kurulum kuyruğuna
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
  'dosyalar', jsonb_build_array(:'mekan_k' || '/r1/rapor.jpg'))) ->> 'id' as rapor \gset

-- Barista belgeleri/girişleri göremez; kendi defterini görür
select pg_temp.dogrula((select count(*) = 0 from belgeler), 'barista belgeleri görüyor');
select pg_temp.dogrula((select count(*) = 0 from belge_satirlari), 'barista belge satırlarını (fiyatlı) görüyor');
select pg_temp.dogrula((select count(*) = 0 from girisler), 'barista girişleri görüyor');
select pg_temp.dogrula((select count(*) = 0 from giris_kalemleri), 'barista giriş tutarlarını görüyor');
select pg_temp.dogrula((select count(*) >= 1 from eslestirme_defteri), 'barista eşleştirme defterini göremiyor');
select pg_temp.dogrula((select bekleyen_fatura = 0 from public.eksik_belge_ozeti()), 'barista eksik özetini (patron) görüyor');
select pg_temp.hata_bekle($$select public.kurulum_kuyrugu()$$, 'yalnızca kurulum');

-- Patron: rapor eksik bilgisi
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000001','patronK@x.com');
select pg_temp.dogrula((select bekleyen_fatura = 3 and bekleyen_satir = 5 and bekleyen_satis_raporu = 1 from public.eksik_belge_ozeti()),
  'patron eksik özeti yanlış');
select pg_temp.hata_bekle($$select public.kurulum_kuyrugu()$$, 'yalnızca kurulum');
select pg_temp.hata_bekle($$select public.kurulum_belge_onayla(gen_random_uuid())$$, 'yalnızca kurulum');

-- Kafe L (başka mekan): K'nin hiçbir şeyini görmez
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000003','patronL@x.com');
select public.mekan_olustur('Kafe L','Lale');
select pg_temp.dogrula((select count(*) = 0 from belgeler), 'L, K''nin belgelerini görüyor');
select pg_temp.dogrula((select count(*) = 0 from eslestirme_defteri), 'L, K''nin defterini görüyor');
select pg_temp.dogrula((select bekleyen_fatura = 0 from public.eksik_belge_ozeti()), 'L, K''nin eksiklerini görüyor');
select pg_temp.dogrula((select count(*) = 0 from storage.objects), 'L, K''nin dosyalarını görüyor');
select pg_temp.hata_bekle(format($$select public.kaydi_geri_al('belge', %L)$$, :'belge1'), 'bulunamadı');

-- KURULUM HESABI
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000009','kurulum@x.com');
select pg_temp.dogrula((select count(*) = 3 from storage.objects where name like :'mekan_k' || '/%'), 'kurulum belge dosyalarını göremiyor');
select pg_temp.dogrula((select count(*) = 0 from malzeme_hareketleri), 'kurulum stok verisine doğrudan erişiyor');
select public.kurulum_kuyrugu() as kuyruk \gset
select pg_temp.dogrula(jsonb_array_length((:'kuyruk')::jsonb) = 1
  and jsonb_array_length((:'kuyruk')::jsonb -> 0 -> 'belgeler') = 4
  and jsonb_array_length((:'kuyruk')::jsonb -> 0 -> 'malzemeler') = 2, 'kurulum kuyruğu yanlış');

-- Belirsiz "ESPRESSO ÇEKİRDEK 1KG" → Kahve, 1 adet = 1000 g; deftere yaz
reset role;
select id as satir_esp from belge_satirlari where metin like 'ESPRESSO%' \gset
select id as satir_k250 from belge_satirlari where belge_id = :'belge2' and metin = 'KAHVE 250G' \gset
select id as satir_tutar from belge_satirlari where belge_id = :'belge4' and metin = 'KAHVE 250G' \gset
select id as satir_fiyat from belge_satirlari where belge_id = :'belge4' and metin like 'SÜTAŞ%' \gset
select pg_temp.dogrula((select bekleme_sebebi from belge_satirlari where id = :'satir_tutar') = 'tutar', 'tutar sebebi yanlış');
select pg_temp.dogrula((select bekleme_sebebi from belge_satirlari where id = :'satir_fiyat') = 'fiyat', 'fiyat sebebi yanlış');
select pg_temp.dogrula((select bekleme_sebebi = 'eslesme' and aday_malzeme_id is not null and malzeme_id is null
  from belge_satirlari where id = :'satir_esp'), 'belirsiz satır yanlış');
set role authenticated;
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000009','kurulum@x.com');
select public.kurulum_satir_coz(:'satir_esp', 'malzeme', :'kahve', 1000, null, null, null, true);
select public.kurulum_satir_coz(:'satir_k250', 'malzeme', :'kahve', 250, null, null, null, true);
select pg_temp.hata_bekle(format($$select public.kurulum_satir_coz(%s, 'malzeme', %L, 1000, null, null, null, true)$$,
  :'satir_esp', :'kahve'), 'zaten çözülmüş');
select pg_temp.hata_bekle(format($$select public.kurulum_satir_coz(%s, 'malzeme', gen_random_uuid(), 1, null, null, null, true)$$,
  :'satir_tutar'), 'bu mekana ait değil');
-- Satır içi tutarsızlık: miktar aslında 5 (10 yanlış okunmuş) → düzeltilerek stoğa
select public.kurulum_satir_coz(:'satir_tutar', 'malzeme', :'kahve', 250, 5, null, null, false);
-- Belge 3: kurulum faturaya bakıp toplamı onaylar → eşleşmiş satır stoğa
select public.kurulum_belge_onayla(:'belge3');
-- Belge 4'teki pahalı süt: gerçekten yanlış belge → reddet
select public.kurulum_belge_reddet(:'belge4');
select public.kurulum_satis_raporu_tamam(:'rapor');

reset role;
select pg_temp.dogrula((select durum from belgeler where id = :'belge2') = 'tamam', 'belge 2 çözülünce tamamlanmadı');
select pg_temp.dogrula((select durum from belgeler where id = :'belge3') = 'tamam', 'belge 3 onaylanınca tamamlanmadı');
select pg_temp.dogrula((select iptal_zamani is not null from belgeler where id = :'belge4'), 'belge 4 reddedilmedi');
select pg_temp.dogrula((select giris_id is not null from belgeler where id = :'belge4'), 'belge 4''te kısmi stok girişi bekleniyordu');
select pg_temp.dogrula((select g.iptal_zamani is not null from girisler g join belgeler b on b.giris_id = g.id where b.id = :'belge4'),
  'reddedilen belgenin stok girişi iptal edilmedi');
-- Kahve stoğa: belge2 → 2×1000 + 1×250 = 2250 g
select pg_temp.dogrula((select sum(h.miktar) = 2250 from malzeme_hareketleri h join belgeler b on b.giris_id = h.giris_id
  where b.id = :'belge2' and h.malzeme_id = :'kahve'), 'kurulum çözümü stoğa yanlış girdi');
select pg_temp.dogrula((select count(*) = 1 from eslestirme_defteri where kaynak = 'kurulum' and metin_anahtar = 'espresso cekirdek 1kg'),
  'kurulum eşleşmesi deftere yazılmadı');

-- TAKİP DIŞI YALNIZ DEFTERDEN: telefon "takip dışı" dese de defterde yoksa satır bekler
set role authenticated;
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select pg_temp.belge('11111111-aaaa-0000-0000-000000000007', repeat('7', 64), null, 'P1', '1234567890', 60.6,
  '[{"metin":"PEÇETE 100LÜ","miktar":3,"birim":"adet","tutar_haric":50,"kdv_orani":20,"sinif":"takip_disi"},
    {"metin":"ESPRESSO BLEND 1KG","miktar":1,"birim":"adet","tutar_haric":0.5,"kdv_orani":20,"sinif":"takip_disi"}]') as p1 \gset
select pg_temp.dogrula(((:'p1')::jsonb ->> 'bekleyen')::int = 2 and ((:'p1')::jsonb ->> 'takip_disi')::int = 0,
  'defterde olmayan takip dışı kabul edildi: ' || :'p1');
-- Kurulum: espresso'yu kahveye bağlar, kalanların (peçete) hepsini takip dışı sayar → deftere yazılır
reset role;
select id as satir_blend from belge_satirlari where metin = 'ESPRESSO BLEND 1KG' \gset
set role authenticated;
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000009','kurulum@x.com');
select public.kurulum_satir_coz(:'satir_blend', 'malzeme', :'kahve', 1000, null, null, null, true);
select pg_temp.dogrula(public.kurulum_kalanlar_takip_disi(((:'p1')::jsonb ->> 'id')::uuid) = 1, 'kalanlar takip dışı sayılmadı');
select pg_temp.hata_bekle($$select public.kurulum_kalanlar_takip_disi(gen_random_uuid())$$, 'Belge bulunamadı');
-- Bir dahaki faturada peçete sorusuz takip dışı
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select pg_temp.hata_bekle(format($$select public.kurulum_kalanlar_takip_disi(%L)$$, (:'p1')::jsonb ->> 'id'), 'yalnızca kurulum');
select pg_temp.belge('11111111-aaaa-0000-0000-000000000008', repeat('8', 64), null, 'P2', '1234567890', 60,
  '[{"metin":"Peçete 100lü","miktar":3,"birim":"adet","tutar_haric":50,"kdv_orani":20,"sinif":"takip_disi"}]') as p2 \gset
select pg_temp.dogrula(((:'p2')::jsonb ->> 'takip_disi')::int = 1 and (:'p2')::jsonb ->> 'durum' = 'tamam',
  'defterdeki takip dışı uygulanmadı: ' || :'p2');
reset role;
select pg_temp.dogrula((select durum = 'tamam' from belgeler where istek_id = '11111111-aaaa-0000-0000-000000000007'),
  'belge P1 çözülünce tamamlanmadı');

-- Barista, kurulumun kararını defterde ezemez
set role authenticated;
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select pg_temp.belge('11111111-aaaa-0000-0000-000000000005', repeat('e', 64), null, 'X5', '1234567890', 101,
  jsonb_build_array(jsonb_build_object('metin', 'ESPRESSO ÇEKİRDEK 1KG', 'miktar', 1, 'birim', 'adet', 'tutar_haric', 100,
    'kdv_orani', 1, 'sinif', 'eslesti', 'malzeme_id', :'sut', 'carpan', 1, 'barista_onayi', true))) as s5 \gset
reset role;
select pg_temp.dogrula((select malzeme_id = :'kahve' and carpan = 1000 from eslestirme_defteri
  where metin_anahtar = 'espresso cekirdek 1kg' and mekan_id = :'mekan_k'), 'barista kurulumun eşleşmesini ezdi');

-- GERİ AL: barista kendi belgesini 2 dakika içinde geri alır; stok ve fiyat geri döner
set role authenticated;
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select public.kaydi_geri_al('belge', ((:'s5')::jsonb ->> 'id')::uuid);
select public.giris_kaydet('fire', public.bugun(), 'Döküldü',
  jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 500))) as fire1 \gset
select public.kaydi_geri_al('giris', :'fire1');
select public.kaydi_geri_al('giris', :'fire1');   -- ikinci kez: sessizce geçer
-- Fire/sayım tekrar denemesi: aynı istek → aynı kayıt, ikinci stok girişi yok
select public.giris_kaydet_tek('22222222-aaaa-0000-0000-000000000001', 'sayim', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 1000))) as sayim1 \gset
select pg_temp.dogrula(public.giris_kaydet_tek('22222222-aaaa-0000-0000-000000000001', 'sayim', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 1000))) = :'sayim1', 'tekrar denemede ikinci sayım');
reset role;
select pg_temp.dogrula((select iptal_zamani is not null from belgeler where istek_id = '11111111-aaaa-0000-0000-000000000005'),
  'barista belgeyi geri alamadı');
select pg_temp.dogrula((select iptal_zamani is not null from girisler where id = :'fire1'), 'barista fireyi geri alamadı');
select pg_temp.dogrula((select count(*) = 1 from girisler where tur = 'sayim' and mekan_id = :'mekan_k'), 'sayım iki kez kaydedildi');
update belgeler set olusturma = now() - interval '3 minutes' where id = :'belge2';
set role authenticated;
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select pg_temp.hata_bekle(format($$select public.kaydi_geri_al('belge', %L)$$, :'belge2'), 'süresi doldu');
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000001','patronK@x.com');
select pg_temp.hata_bekle(format($$select public.kaydi_geri_al('belge', %L)$$, :'belge1'), 'bulunamadı');   -- başkasının kaydı
-- İptal edilen belge yeniden yüklenebilir (aynı dosya özeti artık serbest)
select pg_temp.ol('bbbbbbbb-0000-0000-0000-000000000002','baristaK@x.com');
select pg_temp.belge('11111111-aaaa-0000-0000-000000000006', repeat('e', 64), null, 'X5', '1234567890', 101,
  '[{"metin":"x","miktar":1,"birim":"adet","tutar_haric":100,"kdv_orani":1,"sinif":"takip_disi"}]') is not null as ok \gset

reset role;
set role anon;
select pg_temp.hata_bekle($$select public.belge_kaydet('{}')$$, 'permission denied');
select pg_temp.hata_bekle($$select public.kurulum_kuyrugu()$$, 'permission denied');
select pg_temp.hata_bekle($$select * from belgeler$$, 'permission denied');
select pg_temp.hata_bekle($$select * from eslestirme_defteri$$, 'permission denied');
select pg_temp.hata_bekle($$select public.malzeme_fiyatlari()$$, 'permission denied');
reset role;
\echo 'TUM BELGE/KURULUM TESTLERI GECTI'
