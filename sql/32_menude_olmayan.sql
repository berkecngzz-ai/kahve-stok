-- 32_menude_olmayan.sql: menüye girilmemiş ürün yok sayılır (kullanıcı kuralı 2026-10-28: "girilmemiş ürün stoğa çekilmez,
-- okunmaz, veri verilmez; işletme yalnız istediğini takip eder").
--  * satis_raporu_isle: menüde karşılığı olmayan (urun_id boş) kasa satırları kaydedilmez. Kasa adı → "takip etmiyoruz"
--    hafızası (satis_eslesmeleri) yine yazılır.
--  * tarifsiz_satislar + rapor uyarısı: yalnız MENÜDEKİ ama reçetesi olmayan ürün (işletmenin takip etmek istediği).
-- Eski kayıtlardaki menü dışı satırlar silinmez; hiçbir hesap ve uyarıya girmez.
begin;

alter function public.satis_raporu_isle(uuid, jsonb, jsonb) rename to satis_raporu_isle_v26;
create or replace function public.satis_raporu_isle(p_belge uuid, p_satirlar jsonb, p_eslesmeler jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(x), '[]') into v from jsonb_array_elements(coalesce(p_satirlar, '[]')) x
    where nullif(x ->> 'urun_id', '') is not null;
  if jsonb_array_length(v) = 0 then raise exception 'Raporda menüdeki ürünlerden hiçbiri yok.'; end if;
  return satis_raporu_isle_v26(p_belge, v, p_eslesmeler);
end $$;

create or replace function public.tarifsiz_satislar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('urun', ad, 'adet', adet, 'menude', true) order by adet desc), '[]')
  from (select u.ad, sum(s.adet) adet
        from satis_satirlari s join urunler u on u.id = s.urun_id
        where s.mekan_id = benim_mekanim() and s.tur = 'satis' and s.tarih > bugun() - 30
          and not exists (select 1 from tarif_surumleri t where t.urun_id = s.urun_id)
        group by u.ad) x
  where benim_mekanim() is not null
$$;

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

revoke all on function public.satis_raporu_isle_v26(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.satis_raporu_isle(uuid, jsonb, jsonb), public.tarifsiz_satislar(), public.stok_farki(uuid) from public, anon;
grant execute on function public.satis_raporu_isle(uuid, jsonb, jsonb), public.tarifsiz_satislar(), public.stok_farki(uuid) to authenticated;

commit;
