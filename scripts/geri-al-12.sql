-- GERİ DÖNÜŞ: sql/12_stok_duzeltmeleri.sql'den önceki fonksiyonlara döner (tanımlar canlı yedekten birebir:
-- Desktop/kahve-stok-yedek/2026-10-21_canliya-alma-oncesi/_fonksiyonlar.sql). Veri değiştirmez.
-- 12 ile oluşan veriler (rapordan girilen satışlar vb.) kalır; yalnız yeni işlevler kalkar.
-- Ön yüz de geri alınmalı (git revert + push), yoksa Rapor sekmesi ve kurulum bağlama hata verir.
begin;
drop function if exists public.stok_farki(uuid);
drop function if exists public.kurulum_satis_raporu_isle(uuid, date, jsonb);
drop function if exists public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean, boolean);

CREATE OR REPLACE FUNCTION public.kurulum_satir_coz(p_satir bigint, p_sonuc text, p_malzeme uuid, p_carpan numeric, p_miktar numeric, p_tutar_haric numeric, p_kdv_orani numeric, p_deftere_yaz boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s belge_satirlari;
  b belgeler;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  select * into s from belge_satirlari where id = p_satir for update;
  if not found or s.durum <> 'bekliyor' then raise exception 'Satır bulunamadı ya da zaten çözülmüş.'; end if;
  select * into b from belgeler where id = s.belge_id;
  if b.iptal_zamani is not null then raise exception 'Bu belge iptal edilmiş.'; end if;

  if p_sonuc = 'takip_disi' then
    update belge_satirlari set durum = 'takip_disi', bekleme_sebebi = null, malzeme_id = null, stok_miktari = null,
                               cozen = 'kurulum', cozum_zamani = now() where id = p_satir;
    if p_deftere_yaz then
      insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, kaynak)
        values (s.mekan_id, b.tedarikci_anahtar, s.metin_anahtar, coalesce(s.birim, 'diger'), 'takip_disi', 'kurulum')
        on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
          set sonuc = 'takip_disi', malzeme_id = null, carpan = null, kaynak = 'kurulum', guncelleme = now();
    end if;
  elsif p_sonuc = 'malzeme' then
    if not exists (select 1 from malzemeler where id = p_malzeme and mekan_id = s.mekan_id) then
      raise exception 'Malzeme bu mekana ait değil.';
    end if;
    if p_carpan is null or p_carpan <= 0 or p_carpan > 1000000 then raise exception 'Çarpanı yaz (1 belge birimi = kaç g/ml/adet).'; end if;
    s.miktar := coalesce(p_miktar, s.miktar);
    s.tutar_haric := coalesce(p_tutar_haric, s.tutar_haric);
    s.kdv_orani := coalesce(p_kdv_orani, s.kdv_orani);
    if s.miktar is null or s.miktar <= 0 then raise exception 'Miktarı yaz.'; end if;
    if s.tutar_haric is null or s.tutar_haric < 0 or s.kdv_orani is null or s.kdv_orani not between 0 and 100 then
      raise exception 'Tutarı ve KDV oranını yaz.';
    end if;
    update belge_satirlari
      set durum = 'stokta', bekleme_sebebi = null, malzeme_id = p_malzeme, carpan = p_carpan,
          miktar = round(s.miktar, 3), tutar_haric = round(s.tutar_haric, 2), kdv_orani = s.kdv_orani,
          stok_miktari = round(s.miktar * p_carpan, 3), cozen = 'kurulum', cozum_zamani = now()
      where id = p_satir;
    if p_deftere_yaz then
      insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, kaynak)
        values (s.mekan_id, b.tedarikci_anahtar, s.metin_anahtar, coalesce(s.birim, 'diger'), 'malzeme', p_malzeme, p_carpan, 'kurulum')
        on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
          set sonuc = 'malzeme', malzeme_id = excluded.malzeme_id, carpan = excluded.carpan,
              kaynak = 'kurulum', guncelleme = now();
    end if;
    perform belge_satiri_stokla(p_satir);
  else
    raise exception 'Geçersiz seçim.';
  end if;
  perform belge_durumu_yenile(s.belge_id);
end $function$
;;

CREATE OR REPLACE FUNCTION public.giris_iptal(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g girisler;
begin
  select * into g from girisler where id = p_id and mekan_id = benim_mekanim() for update;
  if not found then raise exception 'Kayıt bulunamadı.'; end if;
  if g.iptal_zamani is not null then raise exception 'Bu kayıt zaten iptal edilmiş.'; end if;
  if not patron_muyum() and (g.giren is distinct from auth.uid()
      or (g.olusturma at time zone 'Europe/Istanbul')::date <> bugun()) then
    raise exception 'Barista yalnızca kendi girdiği kaydı aynı gün iptal edebilir. Bu kaydı patron iptal edebilir.';
  end if;
  update girisler
    set iptal_eden = auth.uid(),
        iptal_eden_ad = coalesce((select ad from uyeler where user_id = auth.uid()), '?'),
        iptal_zamani = now()
    where id = p_id;
  if g.tur = 'fatura' then
    perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = p_id and tutar > 0;
  end if;
end $function$
;;

CREATE OR REPLACE FUNCTION public.kurulum_kuyrugu()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'mekan_id', k.id, 'mekan', k.ad,
      'malzemeler', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'ad', m.ad, 'birim', m.birim) order by m.ad), '[]')
                     from malzemeler m where m.mekan_id = k.id and m.aktif),
      'belgeler', (select jsonb_agg(jsonb_build_object(
          'id', b.id, 'tur', b.tur, 'kaynak', b.kaynak, 'tedarikci', b.tedarikci, 'tarih', b.belge_tarihi,
          'fatura_no', b.fatura_no, 'genel_toplam', b.genel_toplam, 'kdv_haric_toplam', b.kdv_haric_toplam,
          'indirim', b.indirim, 'toplam_tutuyor', b.toplam_tutuyor, 'giren_ad', b.giren_ad, 'olusturma', b.olusturma,
          'dosyalar', (select coalesce(jsonb_agg(jsonb_build_object('yol', d.yol, 'tur', d.tur)), '[]')
                       from belge_dosyalari d where d.belge_id = b.id),
          'satirlar', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', s.id, 'sira', s.sira, 'metin', s.metin, 'miktar', s.miktar, 'birim', s.birim,
              'birim_fiyat', s.birim_fiyat, 'tutar_haric', s.tutar_haric, 'kdv_orani', s.kdv_orani,
              'durum', s.durum, 'sebep', s.bekleme_sebebi, 'aday_malzeme_id', s.aday_malzeme_id,
              'malzeme_id', s.malzeme_id, 'carpan', s.carpan) order by s.sira), '[]')
            from belge_satirlari s where s.belge_id = b.id)) order by b.olusturma)
        from belgeler b where b.mekan_id = k.id and b.durum = 'bekliyor' and b.iptal_zamani is null)))
    from mekanlar k
    where exists (select 1 from belgeler b where b.mekan_id = k.id and b.durum = 'bekliyor' and b.iptal_zamani is null)
  ), '[]'::jsonb);
end $function$
;;

revoke all on function public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean),
  public.giris_iptal(uuid), public.kurulum_kuyrugu() from public, anon, authenticated;
grant execute on function public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean),
  public.giris_iptal(uuid), public.kurulum_kuyrugu() to authenticated;
commit;
