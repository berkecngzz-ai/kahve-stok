-- 31_okuma_duzeltme.sql: fotoğraftan yanlış okunan miktar faturanın kendi rakamlarından düzelir, kuyruğa düşmez.
-- Sorun (canlı test, 2026-10-28): AI "36 adet süt" satırını 3 okudu (tutar doğru: 2.088 TL). Birim fiyat 696 TL/litre çıktı
-- → satir_olagandisi 'fiyat' → satır ekip kuyruğuna düştü; her yanlış okumada elle bakmak gerekiyordu.
-- Çözüm: fiyat/miktar şüphesiyle bekleyen eşleşmiş satırda (barista ayrıca saymadıysa) doğru miktar faturadan çıkarılır:
--   1) satırın kendi birim fiyatı okunmuşsa: miktar = tutar ÷ birim fiyat (tam sayıya %2 yakın olmalı)
--   2) koli/paket karışması: tutar ÷ (bu tedarikçinin son fiyatı × çarpan) okunan miktarın TAM katıysa (2, 3, 4, 6,
--      10, 12, 24… %2 içinde) miktar o kat kadar.  Gerçek zam (ör. %30) tam kat olmadığı için düzeltilmez.
--   Bulunan miktarla birim fiyat referansın %15'i içinde olmalı ve miktar olağandışı kontrolünü geçmeli; geçerse satır
--   stoğa girer (teslimat = okuma_hatasi, okunan_miktar ilk okumayı saklar), geçmezse eskisi gibi kuyrukta kalır.
begin;

create or replace function public.fatura_okuma_duzelt(p_belge uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  b belgeler;
  s belge_satirlari;
  m malzemeler;
  v_dahil numeric;
  v_kat numeric;        -- fiyat birimi (kg/litre/adet) → taban birim (g/ml/adet)
  v_ref numeric;        -- taban birim başına referans fiyat (KDV dahil)
  v_aday numeric;
  v_n numeric;
  v_yeni numeric;
  v_sebep text;
  v_say int := 0;
begin
  select * into b from belgeler where id = p_belge;
  if not found or b.tur <> 'fatura' or b.iptal_zamani is not null then return 0; end if;
  for s in select * from belge_satirlari
           where belge_id = p_belge and durum = 'bekliyor' and bekleme_sebebi in ('fiyat', 'miktar')
             and malzeme_id is not null and carpan > 0 and miktar > 0
             and (gelen_miktar is null or gelen_miktar = miktar)          -- barista ayrıca saydıysa onun sayısı esas
           order by sira for update loop
    v_dahil := satir_dahil_tutar(s.tutar_dahil, s.tutar_haric, s.kdv_orani);
    continue when v_dahil is null or v_dahil <= 0;
    select * into m from malzemeler where id = s.malzeme_id;
    v_kat := case m.birim when 'adet' then 1 else 1000 end;
    -- Referans: aynı tedarikçinin bu malzemedeki son doğrulanmış fatura fiyatı; yoksa 90 günlük ortalama; yoksa kayıtlı fiyat
    select f.fiyat / v_kat into v_ref
      from fiyat_gecmisi f join belgeler x on x.giris_id = f.giris_id
      where f.malzeme_id = s.malzeme_id and f.kaynak = 'fatura' and x.tedarikci_anahtar = b.tedarikci_anahtar
        and x.id <> b.id and x.iptal_zamani is null
      order by f.tarih desc, f.id desc limit 1;
    v_ref := coalesce(v_ref, nullif(malzeme_birim_maliyet(s.malzeme_id, bugun()), 0), nullif(m.fiyat, 0) / v_kat);
    continue when v_ref is null or v_ref <= 0;
    v_yeni := null;
    -- 1) satırın kendi birim fiyatından
    if s.birim_fiyat > 0 then
      v_aday := coalesce(s.tutar_haric, v_dahil) / s.birim_fiyat;
      v_n := round(v_aday);
      if v_n >= 1 and v_n <> s.miktar and abs(v_aday - v_n) <= greatest(0.02 * v_n, 0.02)
         and abs(v_dahil / (v_n * s.carpan) - v_ref) <= 0.15 * v_ref then
        v_yeni := v_n;
      end if;
    end if;
    -- 2) koli/paket katı
    if v_yeni is null then
      v_aday := v_dahil / (v_ref * s.carpan);
      v_n := round(v_aday / s.miktar);
      if v_n in (2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 36, 48)
         and abs(v_aday - v_n * s.miktar) <= 0.02 * v_n * s.miktar then
        v_yeni := v_n * s.miktar;
      end if;
    end if;
    continue when v_yeni is null;
    v_sebep := satir_olagandisi(s.mekan_id, s.malzeme_id, round(v_yeni * s.carpan, 3), v_dahil, 0);
    continue when v_sebep is not null;
    update belge_satirlari
      set okunan_miktar = coalesce(okunan_miktar, miktar), miktar = v_yeni,
          gelen_miktar = case when gelen_miktar is not null then v_yeni end,
          teslimat = 'okuma_hatasi', stok_miktari = round(v_yeni * carpan, 3),
          birim_fiyat = case when tutar_haric is not null then round(tutar_haric / v_yeni, 4) else birim_fiyat end,
          durum = 'stokta', bekleme_sebebi = null, cozen = 'otomatik', cozum_zamani = now()
      where id = s.id;
    perform belge_satiri_stokla(s.id);
    v_say := v_say + 1;
  end loop;
  if v_say > 0 then perform belge_durumu_yenile(p_belge); end if;
  return v_say;
end $$;

-- belge_kaydet: önceki hâli (sql/28) + okuma düzeltmesi
alter function public.belge_kaydet(jsonb) rename to belge_kaydet_v28;
create or replace function public.belge_kaydet(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_id uuid;
begin
  r := belge_kaydet_v28(p);
  v_id := (r ->> 'id')::uuid;
  if coalesce((r ->> 'tekrar')::boolean, false) or (select tur from belgeler where id = v_id) <> 'fatura' then return r; end if;
  if fatura_okuma_duzelt(v_id) = 0 then return r; end if;
  return r || jsonb_build_object(
    'durum', (select durum from belgeler where id = v_id),
    'stoklanan', (select count(*) from belge_satirlari where belge_id = v_id and durum = 'stokta'),
    'bekleyen', (select count(*) from belge_satirlari where belge_id = v_id and durum = 'bekliyor'));
end $$;

revoke all on function public.fatura_okuma_duzelt(uuid), public.belge_kaydet_v28(jsonb) from public, anon, authenticated;
revoke all on function public.belge_kaydet(jsonb) from public, anon;
grant execute on function public.belge_kaydet(jsonb) to authenticated;

-- Şu an kuyrukta bekleyen faturalar da aynı kurala göre bir kez taranır (kural tutmayan satır kuyrukta kalır).
select public.fatura_okuma_duzelt(id) from public.belgeler
  where tur = 'fatura' and iptal_zamani is null and durum = 'bekliyor';

commit;
