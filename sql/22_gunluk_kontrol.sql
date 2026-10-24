-- 22: Barista elle mal girişi (market fişi), fiyat değişimi uyarısı, patronun günlük kontrolü, barista görevi (2026-10-24).
-- 21_mal_kabul.sql'den SONRA çalıştırılır. Yeni tablo YOK; mevcut veriyi değiştirmez.
-- Geri dönüş: scripts/geri-al-22.sql
--
-- Kurallar (kullanıcıyla kararlaştırıldı):
--   * Market fişi nadir: barista malzemeyi seçer, miktarı ve fişteki tutarı (KDV dahil, isteğe bağlı) yazar.
--     Tutar kayıtlı fiyattan %30'dan fazla saparsa stok yine girer ama malzemenin fiyatı DEĞİŞMEZ; satır patronun
--     kontrolüne düşer ("fiyat_kontrol" uyarısı). Fiş okunmaz (AI yok).
--   * Fiyat uyarısı: son fatura fiyatı bir öncekinden %5'ten fazla yüksek VE bu artış son 28 günün kullanımına göre
--     ayda 250 TL'den fazla ek maliyet getiriyorsa. Kullanım verisi (son 28 günde satış raporu) yoksa TL etkisi
--     HESAPLANMAZ (uydurulmaz), uyarı yalnız yüzde olarak bilgi düzeyinde kalır.
--   * Ortalama fiyat ağırlıklıdır: son 90 günde faturayla alınan miktara göre (KDV dahil).

-- ---------- 1) Barista elle mal girişi ----------
-- p_kalemler: [{"malzeme_id": "...", "miktar": 2000, "tutar": 98.50}]   miktar stok biriminde (g / ml / adet),
--             tutar o satırın fişteki KDV dahil tutarı (yoksa null). Telefon her kayıt için tek istek kimliği üretir.
create or replace function public.elle_mal_kabul(p_istek uuid, p_aciklama text, p_kalemler jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_ad text;
  v_id uuid;
  k jsonb;
  m malzemeler;
  v_miktar numeric;
  v_tutar numeric;
  v_oran numeric;
  v_haric numeric;
  v_birim_fiyat numeric;
  v_uyari text[];
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  if p_istek is null then raise exception 'Geçersiz istek.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir malzeme seç.';
  end if;
  if jsonb_array_length(p_kalemler) > 50 then raise exception 'Bir girişte en fazla 50 kalem olabilir.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_mekan::text || p_istek::text, 0));
  select giris_id into v_id from giris_istekleri where mekan_id = v_mekan and istek_id = p_istek;
  if found then return v_id; end if;

  select ad into v_ad from uyeler where user_id = auth.uid();
  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad)
    values (v_mekan, 'fatura', bugun(),
            left('Elle giriş' || coalesce(' · ' || nullif(trim(p_aciklama), ''), ''), 200), auth.uid(), coalesce(v_ad, '?'))
    returning id into v_id;

  for k in select value from jsonb_array_elements(p_kalemler) loop
    select * into m from malzemeler
      where id = case when k ->> 'malzeme_id' ~ '^[0-9a-fA-F-]{36}$' then (k ->> 'malzeme_id')::uuid end
        and mekan_id = v_mekan and aktif;
    if not found then raise exception 'Malzeme bulunamadı.'; end if;
    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then round((k ->> 'miktar')::numeric, 3) end;
    if v_miktar is null or v_miktar <= 0 or v_miktar >= 10000000 then raise exception '% için miktarı yaz.', m.ad; end if;
    v_tutar := case when jsonb_typeof(k -> 'tutar') = 'number' then round((k ->> 'tutar')::numeric, 2) end;
    if v_tutar is not null and (v_tutar < 0 or v_tutar >= 10000000) then raise exception '% için tutar geçersiz.', m.ad; end if;
    v_oran := coalesce(m.kdv_orani, 0);
    v_haric := case when v_tutar is not null then round(v_tutar / (1 + v_oran / 100), 2) end;
    v_uyari := null;
    -- Kayıtlı fiyattan %30'dan fazla sapan tutar fiyatı değiştirmez; patron kontrol eder.
    if v_tutar > 0 and satir_olagandisi(v_mekan, m.id, v_miktar, v_haric, v_oran) = 'fiyat' then
      v_uyari := array['fiyat_kontrol'];
    end if;
    insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani, satir_metni, uyarilar)
      values (v_id, v_mekan, m.id, v_miktar, v_tutar, v_haric, case when v_tutar is not null then v_oran end, 'Elle giriş', v_uyari);
    insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
      values (v_id, v_mekan, m.id, v_miktar)
      on conflict (giris_id, malzeme_id) do update set miktar = malzeme_hareketleri.miktar + excluded.miktar;
    if v_tutar > 0 and v_uyari is null then
      v_birim_fiyat := round(v_haric / v_miktar * (case m.birim when 'adet' then 1 else 1000 end), 4);
      insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id, degistiren, degistiren_ad)
        values (v_mekan, m.id, round(v_birim_fiyat * (1 + v_oran / 100), 2), v_birim_fiyat, v_oran, bugun(), 'fatura', v_id,
                auth.uid(), coalesce(v_ad, '?'));
      perform fiyat_yenile(m.id);
    end if;
  end loop;

  insert into giris_istekleri (mekan_id, istek_id, giris_id) values (v_mekan, p_istek, v_id);
  return v_id;
end $$;

-- ---------- 2) Fiyat değişimleri (patron) ----------
-- Her malzeme için son iki fatura fiyatı (KDV dahil, kg / litre / adet başına), 90 günlük ağırlıklı ortalama ve
-- aylık etki. uyari: %5'ten fazla artış VE ayda 250 TL'den fazla etki (kullanım biliniyorsa).
create or replace function public.fiyat_degisimleri() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_bugun date := bugun();
  v_satis_var boolean;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Fiyat bilgisi yalnız patrona açık.'; end if;
  -- Son 28 günde satış raporu yoksa kullanım bilinmez → TL etkisi hesaplanmaz.
  select exists (select 1 from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null
                   and tarih > v_bugun - 28) into v_satis_var;
  return coalesce((
    with fiyat as (
      select f.malzeme_id, f.fiyat, f.tarih,
             row_number() over (partition by f.malzeme_id order by f.tarih desc, f.zaman desc, f.id desc) sira
      from fiyat_gecmisi f join girisler g on g.id = f.giris_id
      where f.mekan_id = v_mekan and f.kaynak = 'fatura' and g.iptal_zamani is null
    ),
    ort as (
      select gk.malzeme_id, sum(gk.tutar) tutar, sum(gk.miktar) miktar
      from giris_kalemleri gk join girisler g on g.id = gk.giris_id
      where g.mekan_id = v_mekan and g.tur = 'fatura' and g.iptal_zamani is null and g.tarih > v_bugun - 90
        and gk.malzeme_id is not null and not gk.stok_disi and gk.miktar > 0 and gk.tutar > 0
      group by gk.malzeme_id
    ),
    kullanim as (
      select h.malzeme_id, sum(h.miktar) * 30.0 / 28 aylik
      from malzeme_hareketleri h join girisler g on g.id = h.giris_id
      where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tur in ('satis', 'fire') and g.tarih > v_bugun - 28
      group by h.malzeme_id
    ),
    satir as (
      select m.id, m.ad, m.birim, s.fiyat son, s.tarih son_tarih, o.fiyat onceki, o.tarih onceki_tarih,
             case when a.miktar > 0 then round(a.tutar / a.miktar * (case m.birim when 'adet' then 1 else 1000 end), 2) end ortalama,
             case when v_satis_var then coalesce(k.aylik, 0) end aylik_kullanim
      from malzemeler m
      join fiyat s on s.malzeme_id = m.id and s.sira = 1
      join fiyat o on o.malzeme_id = m.id and o.sira = 2
      left join ort a on a.malzeme_id = m.id
      left join kullanim k on k.malzeme_id = m.id
      where m.mekan_id = v_mekan and m.aktif and o.fiyat > 0
    )
    select jsonb_agg(jsonb_build_object(
             'malzeme_id', id, 'ad', ad, 'birim', birim, 'son', son, 'son_tarih', son_tarih,
             'onceki', onceki, 'onceki_tarih', onceki_tarih, 'ortalama', ortalama,
             'degisim_yuzde', round((son - onceki) / onceki * 100, 1),
             'aylik_kullanim', round(aylik_kullanim, 0),
             'aylik_etki', case when aylik_kullanim is not null
                                then round((son - onceki) * aylik_kullanim / (case birim when 'adet' then 1 else 1000 end), 0) end,
             'uyari', (son - onceki) / onceki > 0.05 and aylik_kullanim is not null
                      and (son - onceki) * aylik_kullanim / (case birim when 'adet' then 1 else 1000 end) > 250)
           order by abs(son - onceki) / onceki desc)
    from satir), '[]'::jsonb);
end $$;

-- ---------- 3) Patronun günlük kontrolü ----------
-- Özet ekranının "bugün bakman gerekenler" listesi için tek çağrı. Sorun yoksa her şey sıfır/boş döner.
create or replace function public.gunluk_kontrol() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_bugun date := bugun();
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Bu bilgi yalnız patrona açık.'; end if;
  return jsonb_build_object(
    'bugun', v_bugun,
    'son_sayim', (select max(tarih) from girisler where mekan_id = v_mekan and tur = 'sayim' and iptal_zamani is null),
    'son_satis', (select max(tarih) from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null),
    'acik_teslimat', (select count(*) from teslimat_farklari where mekan_id = v_mekan and durum = 'acik'),
    'acik_teslimat_tl', (select coalesce(sum(fark_tl) filter (where fark_tl > 0), 0) from teslimat_farklari
                          where mekan_id = v_mekan and durum = 'acik'),
    -- Son 7 günde elle girilen ve fiyatı patron kontrolü bekleyen kalemler
    'elle_fiyat_kontrol', coalesce((select jsonb_agg(jsonb_build_object('malzeme', m.ad, 'miktar', gk.miktar, 'birim', m.birim,
                                       'tutar', gk.tutar, 'giren_ad', g.giren_ad, 'tarih', g.tarih) order by g.tarih desc)
                            from giris_kalemleri gk join girisler g on g.id = gk.giris_id join malzemeler m on m.id = gk.malzeme_id
                            where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tarih > v_bugun - 7
                              and 'fiyat_kontrol' = any(gk.uyarilar)), '[]'::jsonb),
    'elle_giris_7gun', (select count(*) from girisler where mekan_id = v_mekan and tur = 'fatura' and iptal_zamani is null
                          and tarih > v_bugun - 7 and aciklama like 'Elle giriş%'));
end $$;

-- ---------- 4) Barista ana ekranı: bugün ne yapılmalı ----------
-- Barista girişleri göremez; yalnız son sayım tarihini alır ("Bugün sayım günü" hatırlatması için).
create or replace function public.barista_durumu() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bugun', bugun(),
    'son_sayim', (select max(tarih) from girisler where mekan_id = benim_mekanim() and tur = 'sayim' and iptal_zamani is null))
  where benim_mekanim() is not null
$$;

-- ---------- Yetkiler ----------
revoke all on function public.elle_mal_kabul(uuid, text, jsonb), public.fiyat_degisimleri(), public.gunluk_kontrol(),
  public.barista_durumu() from public, anon, authenticated;
grant execute on function public.elle_mal_kabul(uuid, text, jsonb), public.fiyat_degisimleri(), public.gunluk_kontrol(),
  public.barista_durumu() to authenticated;
