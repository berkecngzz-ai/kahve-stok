-- 35_gec_kayit_kurallari.sql: kabul testi (2026-10-28) önerileri.
--  1) Barista geriye tarih sınırı: barista sayım/fire'yi yalnız BUGÜN ya da DÜN için girebilir (kapanış sayımını gece yarısından
--     sonra göndermek için dün). Daha eski kaydı patron girer. (Arayüz zaten bugünü kullanır; bu sunucu kuralıdır.)
--  2) Mal ne zaman geldi? belge_kaydet isteğe bağlı 'teslim_tarihi' alır (barista: son 7 gün; patron: son 1 yıl). Verilirse
--     stok o güne yazılır (belgeler.teslim_tarihi); verilmezse eskisi gibi yüklendiği gün.
--  3) Kapanmış hafta: bitiş sayımından 2 günden sonra o dönemi değiştiren kayıt (geç fatura/fire/kasa raporu, iptal, teslim günü
--     ya da sayım düzeltmesi) varsa raporda "Bu hafta kapandıktan sonra N kayıt eklendi ya da düzeltildi" uyarısı.
begin;

-- 1) ---------------------------------------------------------------------------------------------------------------
create or replace function public.giris_kaydet(p_tur text, p_tarih date, p_aciklama text, p_kalemler jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if p_tur = 'fatura' then
    raise exception 'Fatura ekranı güncellendi. Sayfayı yenileyip tekrar dene.';
  end if;
  if p_tur = 'satis' then
    raise exception 'Satış elle girilmez. Kasa programının satış raporunu yükle (Girişler → Satış raporu yükle).';
  end if;
  if not patron_muyum() and p_tarih < bugun() - 1 then
    raise exception 'Barista yalnız bugün ve dün için giriş yapabilir. Daha eski bir kaydı patron girer.';
  end if;
  return giris_kaydet_v1(p_tur, p_tarih, p_aciklama, p_kalemler);
end $$;

-- 2) ---------------------------------------------------------------------------------------------------------------
create or replace function public.belge_satiri_stokla(p_satir bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  s belge_satirlari;
  b belgeler;
  v_birim text;
  v_kat   numeric;
  v_dahil numeric;    -- satırın KDV dahil tutarı (faturadaki miktar için)
  v_fiyat numeric;    -- KDV dahil birim fiyat (kg / litre / adet)
  v_haric numeric;
  v_fstok numeric;    -- faturadaki miktar, stok biriminde
  v_oran  numeric;    -- gelen / faturadaki
  v_kontrol boolean;
begin
  select * into s from belge_satirlari where id = p_satir for update;
  select * into b from belgeler where id = s.belge_id for update;
  if b.giris_id is null then
    insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad,
                          belge_genel_toplam, belge_kdv_haric_toplam, belge_kdv_toplam, belge_indirim)
      values (b.mekan_id, 'fatura', least(coalesce(b.teslim_tarihi, nullif(current_setting('app.teslim_tarihi', true), '')::date,
                                                  (b.olusturma at time zone 'Europe/Istanbul')::date),
                                         bugun()),
              b.tedarikci, b.giren, b.giren_ad, b.genel_toplam, b.kdv_haric_toplam, b.kdv_toplam, b.indirim)
      returning id into b.giris_id;
    update belgeler set giris_id = b.giris_id where id = b.id;
  end if;

  v_fstok := round(coalesce(s.miktar, 0) * coalesce(s.carpan, 0), 3);
  if v_fstok <= 0 then v_fstok := s.stok_miktari; end if;
  v_oran := case when v_fstok > 0 then s.stok_miktari / v_fstok else 1 end;
  v_dahil := satir_dahil_tutar(s.tutar_dahil, s.tutar_haric, s.kdv_orani);
  v_kontrol := s.fiyat_kontrol or v_dahil is null;

  insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani, satir_metni,
                               uyarilar, belge_satir_id)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari, round(v_dahil * v_oran, 2),
            round(s.tutar_haric * v_oran, 2), s.kdv_orani, left(s.metin, 200),
            case when v_kontrol then array['fiyat_kontrol'] end, s.id);
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari)
    on conflict (giris_id, malzeme_id) do update set miktar = malzeme_hareketleri.miktar + excluded.miktar;

  if not v_kontrol and v_dahil > 0 and v_fstok > 0 then
    select birim into v_birim from malzemeler where id = s.malzeme_id;
    v_kat := case v_birim when 'adet' then 1 else 1000 end;
    -- Oran okunduysa eskisi gibi hariç birim fiyat + oran; yalnız dahil tutar varsa doğrudan ondan (oran boş kalır).
    v_haric := case when s.tutar_haric is not null and s.kdv_orani is not null
                    then round(s.tutar_haric / v_fstok * v_kat, 4) end;
    v_fiyat := case when v_haric is not null then round(v_haric * (1 + s.kdv_orani / 100), 2)
                    else round(v_dahil / v_fstok * v_kat, 2) end;
    if v_fiyat < 10000000 then
      insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id,
                                 degistiren, degistiren_ad)
        select b.mekan_id, s.malzeme_id, v_fiyat, v_haric, case when v_haric is not null then s.kdv_orani end,
               g.tarih, 'fatura', b.giris_id, b.giren, b.giren_ad
        from girisler g where g.id = b.giris_id;
      perform fiyat_yenile(s.malzeme_id);
    end if;
  end if;

  -- Sayılan, faturadakinden farklıysa (yuvarlama payı %0,5) patrona görev.
  if s.gelen_miktar is not null and v_fstok > 0
     and abs(s.stok_miktari - v_fstok) > greatest(0.001, 0.005 * greatest(s.stok_miktari, v_fstok)) then
    insert into teslimat_farklari (mekan_id, belge_id, belge_satir_id, malzeme_id, faturadaki, gelen, fark_tl,
                                   okuma_supheli, barista_notu)
      values (s.mekan_id, s.belge_id, s.id, s.malzeme_id, v_fstok, s.stok_miktari,
              round(v_dahil / v_fstok * (v_fstok - s.stok_miktari), 2),
              coalesce(s.teslimat, '') = 'belirsiz', s.barista_notu)
      on conflict (belge_satir_id) do nothing;
  end if;
end $$;

alter function public.belge_kaydet(jsonb) rename to belge_kaydet_v33;
create or replace function public.belge_kaydet(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_teslim date;
  v_sinir int := case when patron_muyum() then 366 else 7 end;   -- barista son 7 gün, patron son 1 yıl
  r jsonb;
begin
  if jsonb_typeof(p -> 'teslim_tarihi') = 'string' and p ->> 'teslim_tarihi' <> '' then
    begin v_teslim := (p ->> 'teslim_tarihi')::date; exception when others then raise exception 'Teslim tarihi geçersiz.'; end;
    if v_teslim > bugun() or v_teslim < bugun() - v_sinir then
      raise exception 'Mal en fazla % gün önce gelmiş olabilir. Daha eskisini patron girer.', v_sinir;
    end if;
    perform set_config('app.teslim_tarihi', v_teslim::text, true);
  end if;
  begin
    r := belge_kaydet_v33(p);
  exception when others then
    perform set_config('app.teslim_tarihi', '', true);
    raise;
  end;
  perform set_config('app.teslim_tarihi', '', true);
  if v_teslim is not null then
    update belgeler set teslim_tarihi = v_teslim where id = (r ->> 'id')::uuid and tur = 'fatura' and teslim_tarihi is null;
  end if;
  return r;
end $$;

-- 3) ---------------------------------------------------------------------------------------------------------------
create or replace function public.stok_farki(p_sayim uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  s2 girisler;
  v_genis boolean;
  v_onceki date;
  v_satirlar jsonb;
  v_baslangic date;
  v_uyari text[] := '{}';
  v_say int;
  v_metin text;
  v_gec int;
  v_gec_son timestamptz;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Stok farkı raporunu yalnızca patron görebilir.'; end if;

  select * into s2 from girisler
    where mekan_id = v_mekan and tur = 'sayim' and iptal_zamani is null and (p_sayim is null or id = p_sayim)
    order by tarih desc, olusturma desc limit 1;
  if not found then
    return jsonb_build_object('durum', 'sayim_yok', 'sayimlar', '[]'::jsonb);
  end if;
  v_genis := (select count(*) from malzeme_hareketleri where giris_id = s2.id) >= 2;
  if v_genis then
    select max(g.tarih) into v_onceki from girisler g
      where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null and g.tarih < s2.tarih
        and (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2;
  end if;

  with sayimlar as (
    select g.id, g.tarih, g.olusturma, h.malzeme_id, h.miktar
    from girisler g join malzeme_hareketleri h on h.giris_id = g.id
    where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
  ),
  son as (
    select distinct on (malzeme_id) malzeme_id, miktar from sayimlar
    where tarih = s2.tarih and olusturma <= s2.olusturma
    order by malzeme_id, olusturma desc
  ),
  ilk as (
    select distinct on (malzeme_id) malzeme_id, miktar, tarih, olusturma,
           not exists (select 1 from sayimlar y where y.malzeme_id = sayimlar.malzeme_id
                       and (y.tarih < sayimlar.tarih or (y.tarih = sayimlar.tarih and y.olusturma < sayimlar.olusturma))) acilis
    from sayimlar
    where tarih < s2.tarih and (v_onceki is null or tarih <= v_onceki)
    order by malzeme_id, tarih desc, olusturma desc
  ),
  hareket as (
    select h.malzeme_id,
           sum(h.miktar) filter (where g.tur = 'fatura') gelen,
           sum(h.miktar) filter (where g.tur = 'satis') satis,
           sum(h.miktar) filter (where g.tur = 'fire') fire
    from malzeme_hareketleri h join girisler g on g.id = h.giris_id
    join ilk on ilk.malzeme_id = h.malzeme_id
    where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tur in ('fatura', 'satis', 'fire')
      and sayimdan_sonra(g.tarih, g.tur, g.olusturma, ilk.tarih, ilk.olusturma, ilk.acilis)
      and not sayimdan_sonra(g.tarih, g.tur, g.olusturma, s2.tarih, s2.olusturma, false)
    group by h.malzeme_id
  ),
  satir as (
    select m.id, m.ad, m.birim, m.aktif,
           malzeme_birim_maliyet(m.id, s2.tarih) maliyet,
           ilk.tarih baslangic_tarih, ilk.miktar baslangic,
           coalesce(hr.gelen, 0) gelen, coalesce(hr.satis, 0) satis, coalesce(hr.fire, 0) fire,
           son.miktar sayilan,
           case when son.malzeme_id is null then 'sayilmadi' when ilk.malzeme_id is null then 'ilk_sayim' else 'tamam' end durum
    from malzemeler m
    left join son on son.malzeme_id = m.id
    left join ilk on ilk.malzeme_id = m.id
    left join hareket hr on hr.malzeme_id = m.id
    where m.mekan_id = v_mekan and (m.aktif or son.malzeme_id is not null)
  ),
  hesap as (
    select *, case when durum = 'tamam' then baslangic + gelen - satis - fire end beklenen from satir
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'malzeme_id', id, 'ad', ad, 'birim', birim,
           'fiyat', round(maliyet * (case birim when 'adet' then 1 else 1000 end), 2), 'durum', durum,
           'baslangic_tarih', baslangic_tarih, 'baslangic', baslangic, 'gelen', gelen, 'satis', satis, 'fire', fire,
           'beklenen', beklenen, 'sayilan', sayilan, 'fark', sayilan - beklenen,
           'fark_tl', case when durum = 'tamam' and maliyet > 0 then round((sayilan - beklenen) * maliyet, 2) end)
         order by (case durum when 'tamam' then 0 when 'ilk_sayim' then 1 else 2 end),
                  (sayilan - beklenen) * maliyet nulls last, ad), '[]'::jsonb),
         min(baslangic_tarih)
    into v_satirlar, v_baslangic
  from hesap;

  select count(*) into v_say from belgeler
    where mekan_id = v_mekan and tur = 'fatura' and durum = 'bekliyor' and iptal_zamani is null
      and coalesce(teslim_tarihi, (olusturma at time zone 'Europe/Istanbul')::date) <= s2.tarih
      and (v_baslangic is null or coalesce(teslim_tarihi, (olusturma at time zone 'Europe/Istanbul')::date) > v_baslangic);
  if v_say > 0 then
    v_uyari := v_uyari || format('%s fatura henüz işlenmedi. İşlenince gelen mal eklenir; bu haftanın rakamları biraz değişebilir.', v_say);
  end if;
  select count(*) into v_say from belgeler
    where mekan_id = v_mekan and tur = 'satis_raporu' and durum = 'bekliyor' and iptal_zamani is null;
  if v_say > 0 then
    v_uyari := v_uyari || format('%s satış raporu henüz işlenmedi. İşlenince açık küçülebilir.', v_say);
  end if;
  if v_baslangic is not null then
    if not exists (select 1 from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null
                   and tarih > v_baslangic and tarih <= s2.tarih) then
      v_uyari := v_uyari || 'Bu dönemde hiç satış raporu yüklenmemiş: satılanlar kayıp gibi görünüyor. Girişler''den satış raporunu yükle.'::text;
    end if;
    select string_agg(format('%s (%s adet)', ad, adet), ', ' order by adet desc) into v_metin
      from (select coalesce(u.ad, min(s.ad)) ad, sum(s.adet) adet
            from satis_satirlari s left join urunler u on u.id = s.urun_id
            where s.mekan_id = v_mekan and s.tur = 'satis' and s.tarih > v_baslangic and s.tarih <= s2.tarih
              and s.urun_id is not null and not exists (select 1 from tarif_surumleri t where t.urun_id = s.urun_id)
            group by s.urun_id, u.ad) x;
    -- Hafta kapandıktan (bitiş sayımından 2 gün) SONRA bu dönemi değiştiren kayıtlar: geç fatura / fire / kasa raporu,
    -- sonradan iptal, teslim günü ya da sayım düzeltmesi. Rakam doğru güncellenir; patron eski raporun değiştiğini bilsin.
    select count(distinct k), max(z) into v_gec, v_gec_son from (
      select 'g' || g.id k, g.olusturma z from girisler g
        where g.mekan_id = v_mekan and g.tur in ('fatura', 'fire') and g.iptal_zamani is null
          and g.tarih > v_baslangic and g.tarih <= s2.tarih and g.olusturma > s2.olusturma + interval '2 days'
      union all
      select 'b' || coalesce(s.belge_id::text, s.id::text), s.olusturma from satis_satirlari s
        where s.mekan_id = v_mekan and s.urun_id is not null and s.tarih > v_baslangic and s.tarih <= s2.tarih
          and s.olusturma > s2.olusturma + interval '2 days'
      union all
      select 'i' || g.id, g.iptal_zamani from girisler g
        where g.mekan_id = v_mekan and g.iptal_zamani > s2.olusturma + interval '2 days'
          and g.tarih >= v_baslangic and g.tarih <= s2.tarih
      union all
      select 'd' || i.id, i.zaman from islem_gecmisi i join girisler g on g.id = i.giris_id
        where i.mekan_id = v_mekan and i.tur in ('teslim_tarihi', 'sayim_duzelt', 'sayim_tarihi')
          and i.zaman > s2.olusturma + interval '2 days' and g.tarih >= v_baslangic and g.tarih <= s2.tarih) x;
    if v_gec > 0 then
      v_uyari := v_uyari || format('Bu hafta kapandıktan sonra %s kayıt eklendi ya da düzeltildi (son: %s). Rakamlar buna göre güncellendi.',
        v_gec, to_char(v_gec_son at time zone 'Europe/Istanbul', 'DD.MM.YYYY'));
    end if;
    if v_metin is not null then
      v_uyari := v_uyari || format('Reçetesi olmayan ürün satıldı, stoktan düşülmedi: %s. Takip etmek istediğin varsa Ayarlar → Ürünler''den reçetesini gir.', v_metin);
    end if;
  end if;

  return jsonb_build_object(
    'durum', 'tamam',
    'sayim_id', s2.id, 'bitis', s2.tarih, 'baslangic', v_baslangic, 'genis', v_genis,
    'satirlar', v_satirlar,
    'toplam_acik_tl', (select coalesce(sum((x ->> 'fark_tl')::numeric), 0) from jsonb_array_elements(v_satirlar) x
                       where (x ->> 'fark_tl')::numeric < 0),
    'toplam_fazla_tl', (select coalesce(sum((x ->> 'fark_tl')::numeric), 0) from jsonb_array_elements(v_satirlar) x
                        where (x ->> 'fark_tl')::numeric > 0),
    'uyarilar', to_jsonb(v_uyari),
    'sayimlar', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tarih', tarih, 'genis', genis)
                                           order by tarih desc, olusturma desc), '[]')
                 from (select g.id, g.tarih, g.olusturma,
                              (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2 genis
                       from girisler g
                       where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
                       order by g.tarih desc, g.olusturma desc limit 60) x));
end $$;

revoke all on function public.belge_kaydet_v33(jsonb), public.belge_satiri_stokla(bigint) from public, anon, authenticated;
revoke all on function public.belge_kaydet(jsonb), public.giris_kaydet(text, date, text, jsonb), public.stok_farki(uuid) from public, anon;
grant execute on function public.belge_kaydet(jsonb), public.giris_kaydet(text, date, text, jsonb), public.stok_farki(uuid) to authenticated;

commit;
