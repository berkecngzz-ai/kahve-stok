-- 21_mal_kabul.sql testleri: kör sayım, teslimat farkı, işlem geçmişi, mükerrer kontrolü, yetki ve izolasyon.
-- Sıra: ... 20, test/patron_ekranlari_test.sql, sql/21_mal_kabul.sql, bu dosya (node test/sql-calistir.mjs --hepsi).
\set ON_ERROR_STOP 1
insert into auth.users values
 ('f2f2f2f2-0000-0000-0000-000000000001','patronMK@x.com'),
 ('f2f2f2f2-0000-0000-0000-000000000002','baristaMK@x.com'),
 ('f2f2f2f2-0000-0000-0000-000000000003','patronMQ@x.com'),
 ('f2f2f2f2-0000-0000-0000-000000000009','kurulumMK@x.com');
insert into public.kurulum_hesaplari (user_id) values ('f2f2f2f2-0000-0000-0000-000000000009');

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
-- Tek satırlı, fotoğraftan okunmuş fatura. satir: barista_onayi'li eşleşmiş satır + sayım alanları.
create or replace function pg_temp.fatura(istek text, ozet text, genel numeric, satir jsonb, ettn text default null)
returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', istek, 'tur', 'fatura', 'kaynak', 'ocr', 'dosya_ozeti', ozet, 'tedarikci', 'Anadolu Süt',
    'tedarikci_vkn', '4444444444', 'tarih', public.bugun(), 'ettn', ettn,
    'toplamlar', jsonb_build_object('genel', genel), 'okunan', jsonb_build_object('not', 'test'),
    'satirlar', jsonb_build_array(satir))) $$;
create or replace function pg_temp.sut(miktar numeric, haric numeric, malzeme uuid, ek jsonb) returns jsonb language sql as $$
  select jsonb_build_object('metin', 'TAM YAĞLI SÜT 1L', 'miktar', miktar, 'birim', 'lt', 'tutar_haric', haric,
    'kdv_orani', 1, 'sinif', 'eslesti', 'malzeme_id', malzeme, 'carpan', 1000, 'barista_onayi', true) || ek $$;
create or replace function pg_temp.satir(belge jsonb) returns bigint language sql as $$
  select id from public.belge_satirlari where belge_id = (belge ->> 'id')::uuid order by sira limit 1 $$;

set role authenticated;

-- ===== Kafe MK: patron, barista, süt =====
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000001','patronMK@x.com');
select public.mekan_olustur('Kafe MK','Meltem');
select id as mekan_mk, davet_kodu as kod_mk from mekanlar where ad = 'Kafe MK' \gset
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Süt','ml',40,1);
select id as sut from malzemeler where ad = 'Süt' \gset
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000002','baristaMK@x.com');
select public.mekana_katil(:'kod_mk','Barış');

-- ===== Kafe MQ (başka mekan) =====
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000003','patronMQ@x.com');
select public.mekan_olustur('Kafe MQ','Kemal');

-- ================================================================================================
-- 1) FATURADA 24 L, BARİSTA 22 L SAYDI → stok 22 L, fiyat faturadan, 2 L eksik görevi
-- ================================================================================================
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000002','baristaMK@x.com');
-- 24 L × 40 TL = 960 TL hariç, %1 KDV → 969,60 TL
select pg_temp.fatura('31313131-0000-0000-0000-000000000001', repeat('a', 64), 969.60,
  pg_temp.sut(24, 960, :'sut', jsonb_build_object('gelen_miktar', 22, 'teslimat', 'teslimat_farki',
    'barista_notu', 'Bir koli eksik geldi')), '0a0a0a0a-1111-2222-3333-444444444444') as f1 \gset
select pg_temp.dogrula((:'f1')::jsonb ->> 'durum' = 'tamam', 'eksik teslimatlı fatura tamamlanmadı: ' || :'f1');
reset role;
select pg_temp.satir((:'f1')::jsonb) as f1_satir \gset
select pg_temp.dogrula((select stok_miktari = 22000 and gelen_miktar = 22 and miktar = 24 and sayim = 'sayildi'
  and teslimat = 'teslimat_farki' and durum = 'stokta' from belge_satirlari where id = :'f1_satir'), 'stok sayılan (22 L) kadar girmedi');
select pg_temp.dogrula((select sum(miktar) = 22000 from malzeme_hareketleri where malzeme_id = :'sut'), 'hareket 22 L değil');
-- Fiyat faturadaki 24 L'den: 960 / 24 = 40 TL/L hariç, 40,40 dahil (22 L'ye bölünseydi 43,64 olurdu)
select pg_temp.dogrula((select fiyat = 40.40 and fiyat_haric = 40 from malzemeler where id = :'sut'), 'fiyat eksik teslimattan şişti');
-- Giriş kalemi: alınan malın değeri (22 L × 40 = 880 TL hariç)
select pg_temp.dogrula((select tutar_kdv_haric = 880 and miktar = 22000 from giris_kalemleri where malzeme_id = :'sut'),
  'giriş kalemi alınan mal değeriyle yazılmadı');
select pg_temp.dogrula((select count(*) = 1 from teslimat_farklari f where f.belge_satir_id = :'f1_satir'
  and f.faturadaki = 24000 and f.gelen = 22000 and f.fark_tl = 80.80 and f.durum = 'acik' and not f.okuma_supheli
  and f.barista_notu = 'Bir koli eksik geldi'), 'teslimat farkı görevi doğru açılmadı');
select id as fark1 from teslimat_farklari where belge_satir_id = :'f1_satir' \gset
-- İşlem geçmişi: mal kabul (sayım ayrıntısıyla), giriş, teslimat farkı
select pg_temp.dogrula((select count(*) = 1 from islem_gecmisi where mekan_id = :'mekan_mk' and tur = 'mal_kabul'
  and kullanici_ad = 'Barış' and (ayrinti -> 'kalemler' -> 0 ->> 'gelen')::numeric = 22
  and (ayrinti -> 'kalemler' -> 0 ->> 'faturadaki')::numeric = 24), 'mal kabul geçmişe yazılmadı');
select pg_temp.dogrula((select count(*) = 1 from islem_gecmisi where mekan_id = :'mekan_mk' and tur = 'teslimat_farki'
  and (ayrinti ->> 'fark_tl')::numeric = 80.80), 'teslimat farkı geçmişe yazılmadı');
select pg_temp.dogrula((select count(*) = 1 from islem_gecmisi where mekan_id = :'mekan_mk' and tur = 'giris'),
  'giriş geçmişe yazılmadı');
-- Geçmiş değiştirilemez (yönetici bile)
select pg_temp.hata_bekle($$update islem_gecmisi set kullanici_ad = 'X'$$, 'değiştirilemez');
set role authenticated;

-- ================================================================================================
-- 2) YETKİ VE İZOLASYON: barista ve başka mekan görevi göremez / kapatamaz
-- ================================================================================================
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000002','baristaMK@x.com');
select pg_temp.dogrula((select count(*) = 0 from teslimat_farklari), 'barista teslimat farkını görüyor');
select pg_temp.dogrula((select count(*) = 0 from islem_gecmisi), 'barista işlem geçmişini görüyor');
select pg_temp.hata_bekle(format($$select public.teslimat_farki_coz(%L, 'iade')$$, :'fark1'), 'yalnız patron');
select pg_temp.hata_bekle($$select public.teslimat_gorevleri()$$, 'yalnız patrona');
select pg_temp.hata_bekle($$insert into islem_gecmisi (mekan_id, tur) values (public.benim_mekanim(), 'giris')$$, 'permission denied');
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000003','patronMQ@x.com');
select pg_temp.dogrula((select count(*) = 0 from teslimat_farklari), 'başka mekanın patronu farkı görüyor');
select pg_temp.dogrula((select count(*) = 0 from islem_gecmisi where belge_id = ((:'f1')::jsonb ->> 'id')::uuid),
  'başka mekanın patronu geçmişi görüyor');
select pg_temp.hata_bekle(format($$select public.teslimat_farki_coz(%L, 'iade')$$, :'fark1'), 'Kayıt bulunamadı');
select pg_temp.dogrula((select jsonb_array_length(public.teslimat_gorevleri()) = 0), 'başka mekanın görev listesine fark sızdı');
select pg_temp.dogrula((select (public.belge_kayitli_mi('0a0a0a0a-1111-2222-3333-444444444444', null, null) ->> 'var')::boolean = false),
  'başka mekanda karekodlu fatura "kayıtlı" göründü');

-- ================================================================================================
-- 3) PATRON GÖREVİ KAPATIR (karar patronda)
-- ================================================================================================
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000001','patronMK@x.com');
select pg_temp.dogrula((select count(*) = 1 from teslimat_farklari where durum = 'acik'), 'patron açık görevi görmüyor');
select pg_temp.dogrula((select jsonb_array_length(g) = 1 and g -> 0 ->> 'malzeme' = 'Süt' and (g -> 0 ->> 'fark_tl')::numeric = 80.80
  and g -> 0 ->> 'tedarikci' = 'Anadolu Süt' and g -> 0 ->> 'barista_notu' = 'Bir koli eksik geldi'
  from public.teslimat_gorevleri() g), 'görev listesi doğru değil');
select pg_temp.hata_bekle(format($$select public.teslimat_farki_coz(%L, 'diger')$$, :'fark1'), 'açıklama yaz');
select pg_temp.hata_bekle(format($$select public.teslimat_farki_coz(%L, 'boyle_bir_sey')$$, :'fark1'), 'Geçersiz');
select public.teslimat_farki_coz(:'fark1', 'iade', 'Tedarikçi 2 L iade etti');
select pg_temp.dogrula((select durum = 'cozuldu' and cozum = 'iade' and cozen_ad = 'Meltem' from teslimat_farklari where id = :'fark1'),
  'görev kapanmadı');
select pg_temp.hata_bekle(format($$select public.teslimat_farki_coz(%L, 'iade')$$, :'fark1'), 'zaten kapatılmış');
select pg_temp.dogrula((select jsonb_array_length(public.teslimat_gorevleri()) = 0), 'kapanan görev listede kaldı');
select pg_temp.dogrula((select count(*) = 1 from islem_gecmisi where tur = 'fark_cozuldu' and ayrinti ->> 'cozum' = 'iade'),
  'kapanış geçmişe yazılmadı');
-- Stok değişmedi (karar stoğu oynatmaz; haftalık sayım düzeltir)
reset role;
select pg_temp.dogrula((select sum(miktar) = 22000 from malzeme_hareketleri where malzeme_id = :'sut'), 'görev kapanınca stok değişti');
set role authenticated;

-- ================================================================================================
-- 4) MÜKERRER: aynı karekodlu fatura okumadan önce yakalanır, kayıtta da reddedilir
-- ================================================================================================
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000002','baristaMK@x.com');
select pg_temp.dogrula((select (r ->> 'var')::boolean and r ->> 'giren_ad' = 'Barış'
  from public.belge_kayitli_mi('0A0A0A0A-1111-2222-3333-444444444444', null, null) r), 'karekodlu fatura kayıtlı görünmedi');
select pg_temp.dogrula((select (public.belge_kayitli_mi(null, null, null) ->> 'var')::boolean = false), 'boş kimlik kayıtlı göründü');
select pg_temp.hata_bekle(format($$select pg_temp.fatura('31313131-0000-0000-0000-000000000099', %L, 969.60, pg_temp.sut(24, 960, %L, '{}'), %L)$$,
  repeat('9', 64), :'sut', '0a0a0a0a-1111-2222-3333-444444444444'), 'daha önce yüklenmiş');

-- ================================================================================================
-- 5) TAM TESLİMAT, SAYILAMAYAN MAL, HİÇ GELMEYEN MAL, OKUMA HATASI
-- ================================================================================================
-- Tam: 12 = 12 → fark yok
select pg_temp.fatura('31313131-0000-0000-0000-000000000002', repeat('b', 64), 484.80,
  pg_temp.sut(12, 480, :'sut', jsonb_build_object('gelen_miktar', 12, 'teslimat', 'tam'))) as f2 \gset
-- Sayılamadı (dökme): stok faturadaki kadar, fark yok, iz kalır
select pg_temp.fatura('31313131-0000-0000-0000-000000000003', repeat('c', 64), 242.40,
  pg_temp.sut(6, 240, :'sut', jsonb_build_object('sayim', 'sayilmadi', 'gelen_miktar', 5))) as f3 \gset
-- Hiç gelmedi + okuma şüpheli: stok 0, fark 7 L tamamı
select pg_temp.fatura('31313131-0000-0000-0000-000000000004', repeat('d', 64), 282.80,
  pg_temp.sut(7, 280, :'sut', jsonb_build_object('gelen_miktar', 0, 'teslimat', 'belirsiz'))) as f4 \gset
-- Okuma hatası düzeltildi: AI 1 okudu, barista 2 saydı, ikinci okuma 2 → telefon miktarı 2 gönderir → fark yok
select pg_temp.fatura('31313131-0000-0000-0000-000000000005', repeat('e', 64), 80.80,
  pg_temp.sut(2, 80, :'sut', jsonb_build_object('gelen_miktar', 2, 'teslimat', 'okuma_hatasi', 'okunan_miktar', 1))) as f5 \gset
reset role;
select pg_temp.dogrula((select count(*) = 0 from teslimat_farklari where belge_id = ((:'f2')::jsonb ->> 'id')::uuid), 'tam teslimatta fark açıldı');
select pg_temp.dogrula((select stok_miktari = 6000 and sayim = 'sayilmadi' and gelen_miktar is null
  from belge_satirlari where id = pg_temp.satir((:'f3')::jsonb)), 'sayılamayan mal faturadaki kadar girmedi');
select pg_temp.dogrula((select count(*) = 0 from teslimat_farklari where belge_id = ((:'f3')::jsonb ->> 'id')::uuid), 'sayılamayan malda fark açıldı');
select pg_temp.dogrula((select stok_miktari = 0 and durum = 'stokta' from belge_satirlari where id = pg_temp.satir((:'f4')::jsonb)),
  'hiç gelmeyen mal 0 olarak kaydedilmedi');
select pg_temp.dogrula((select gelen = 0 and faturadaki = 7000 and fark_tl = 282.80 and okuma_supheli
  from teslimat_farklari where belge_id = ((:'f4')::jsonb ->> 'id')::uuid), 'hiç gelmeyen malın farkı doğru değil');
select pg_temp.dogrula((select stok_miktari = 2000 and okunan_miktar = 1 and teslimat = 'okuma_hatasi'
  from belge_satirlari where id = pg_temp.satir((:'f5')::jsonb)), 'okuma hatası düzeltmesi kaydedilmedi');
select pg_temp.dogrula((select count(*) = 0 from teslimat_farklari where belge_id = ((:'f5')::jsonb ->> 'id')::uuid), 'okuma hatasında fark açıldı');
-- Toplam: 22 + 12 + 6 + 0 + 2 = 42 L
select pg_temp.dogrula((select sum(miktar) = 42000 from malzeme_hareketleri where malzeme_id = :'sut'), 'toplam stok 42 L değil');
set role authenticated;

-- ================================================================================================
-- 6) TOPLAM TUTMUYOR: satır bekler, stok ve fark yok; kurulum çözünce sayılan miktar korunur
-- ================================================================================================
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000002','baristaMK@x.com');
select pg_temp.fatura('31313131-0000-0000-0000-000000000006', repeat('f', 64), 999,
  pg_temp.sut(10, 400, :'sut', jsonb_build_object('gelen_miktar', 9, 'teslimat', 'teslimat_farki'))) as f6 \gset
select pg_temp.dogrula((:'f6')::jsonb ->> 'durum' = 'bekliyor', 'toplamı tutmayan fatura beklemeye düşmedi');
reset role;
select pg_temp.satir((:'f6')::jsonb) as f6_satir \gset
select pg_temp.dogrula((select durum = 'bekliyor' and gelen_miktar = 9 from belge_satirlari where id = :'f6_satir'),
  'bekleyen satırda sayım kaybolmadı mı');
select pg_temp.dogrula((select count(*) = 0 from teslimat_farklari where belge_satir_id = :'f6_satir'), 'bekleyen satırda fark açıldı');
set role authenticated;
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000009','kurulumMK@x.com');
select public.kurulum_satir_coz(:f6_satir, 'malzeme', :'sut', 1000, null, null, null, false);
reset role;
select pg_temp.dogrula((select stok_miktari = 9000 and durum = 'stokta' from belge_satirlari where id = :'f6_satir'),
  'kurulum çözünce sayılan miktar (9 L) korunmadı');
select pg_temp.dogrula((select faturadaki = 10000 and gelen = 9000 and fark_tl = 40.40 from teslimat_farklari where belge_satir_id = :'f6_satir'),
  'kurulum çözünce fark açılmadı');
set role authenticated;

-- ================================================================================================
-- 7) GERİ ALMA: barista 2 dk içinde geri alırsa belge iptal, açık fark iptal, geçmişte iz
-- ================================================================================================
select pg_temp.ol('f2f2f2f2-0000-0000-0000-000000000002','baristaMK@x.com');
select pg_temp.fatura('31313131-0000-0000-0000-000000000007', repeat('7', 64), 121.20,
  pg_temp.sut(3, 120, :'sut', jsonb_build_object('gelen_miktar', 1, 'teslimat', 'teslimat_farki')),
  '0b0b0b0b-1111-2222-3333-444444444444') as f7 \gset
select public.kaydi_geri_al('belge', ((:'f7')::jsonb ->> 'id')::uuid);
select pg_temp.dogrula((select (public.belge_kayitli_mi('0b0b0b0b-1111-2222-3333-444444444444', null, null) ->> 'var')::boolean = false),
  'iptal edilen fatura hâlâ kayıtlı görünüyor');
reset role;
select pg_temp.dogrula((select durum = 'iptal' from teslimat_farklari where belge_id = ((:'f7')::jsonb ->> 'id')::uuid),
  'iptal edilen belgenin farkı açık kaldı');
select pg_temp.dogrula((select count(*) = 1 from islem_gecmisi where tur = 'belge_iptal' and belge_id = ((:'f7')::jsonb ->> 'id')::uuid),
  'belge iptali geçmişe yazılmadı');
select pg_temp.dogrula((select count(*) = 1 from islem_gecmisi where tur = 'giris_iptal'
  and giris_id = (select giris_id from belgeler where id = ((:'f7')::jsonb ->> 'id')::uuid)), 'giriş iptali geçmişe yazılmadı');
set role authenticated;

reset role;
select 'mal_kabul_test: TAMAM' as sonuc;
