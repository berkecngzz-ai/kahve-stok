-- 24: Raporun uyarı metinleri sade Türkçe (2026-10-24). Hesap DEĞİŞMEZ; yalnız stok_farki'nin uyarı yazıları.
-- "Fiyatı girilmemiş" uyarısı kalktı: ekran o malzemeleri "TL toplamına girmeyenler" diye ayrıca listeliyor (sql/23).
-- 13_rapor_uyarilari.sql'deki işlevin aynısı. Geri dönüş: sql/13_rapor_uyarilari.sql'i yeniden çalıştır.
create or replace function public.stok_farki(p_sayim uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  s2 girisler;
  v_satirlar jsonb;
  v_baslangic date;
  v_uyari text[] := '{}';
  v_say int;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Stok farkı raporunu yalnızca patron görebilir.'; end if;

  select * into s2 from girisler
    where mekan_id = v_mekan and tur = 'sayim' and iptal_zamani is null and (p_sayim is null or id = p_sayim)
    order by tarih desc, olusturma desc limit 1;
  if not found then
    return jsonb_build_object('durum', 'sayim_yok', 'sayimlar', '[]'::jsonb);
  end if;

  with sayimlar as (
    select g.id, g.tarih, g.olusturma, h.malzeme_id, h.miktar
    from girisler g join malzeme_hareketleri h on h.giris_id = g.id
    where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
  ),
  -- Bitiş: seçilen sayımın günü; aynı gün birden fazla sayım varsa malzeme başına seçilene kadarki en yenisi.
  son as (
    select distinct on (malzeme_id) malzeme_id, miktar from sayimlar
    where tarih = s2.tarih and olusturma <= s2.olusturma
    order by malzeme_id, olusturma desc
  ),
  -- Başlangıç: malzemenin bu günden önceki en yeni sayımı (bir hafta atlanmışsa daha eskisi).
  ilk as (
    select distinct on (malzeme_id) malzeme_id, miktar, tarih from sayimlar
    where tarih < s2.tarih
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
      and g.tarih > ilk.tarih and g.tarih <= s2.tarih
    group by h.malzeme_id
  ),
  satir as (
    select m.id, m.ad, m.birim, m.fiyat, m.aktif,
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
           'malzeme_id', id, 'ad', ad, 'birim', birim, 'fiyat', fiyat, 'durum', durum,
           'baslangic_tarih', baslangic_tarih, 'baslangic', baslangic, 'gelen', gelen, 'satis', satis, 'fire', fire,
           'beklenen', beklenen, 'sayilan', sayilan, 'fark', sayilan - beklenen,
           'fark_tl', case when durum = 'tamam' and fiyat > 0
                           then round((sayilan - beklenen) * fiyat / (case birim when 'adet' then 1 else 1000 end), 2) end)
         order by (case durum when 'tamam' then 0 when 'ilk_sayim' then 1 else 2 end),
                  (sayilan - beklenen) * fiyat / (case birim when 'adet' then 1 else 1000 end) nulls last, ad), '[]'::jsonb),
         min(baslangic_tarih)
    into v_satirlar, v_baslangic
  from hesap;

  -- Sonucu bozabilecek eksikler (rapor yine gösterilir, patron uyarıyı görür).
  -- Yalnız bu döneme düşen faturalar (fatura tarihi; okunamadıysa yükleme günü): sonraki haftanın bekleyen faturası
  -- eski haftaların raporunu "eksik olabilir" diye göstermesin.
  select count(*) into v_say from belgeler
    where mekan_id = v_mekan and tur = 'fatura' and durum = 'bekliyor' and iptal_zamani is null
      and coalesce(belge_tarihi, (olusturma at time zone 'Europe/Istanbul')::date) <= s2.tarih
      and (v_baslangic is null or coalesce(belge_tarihi, (olusturma at time zone 'Europe/Istanbul')::date) > v_baslangic);
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
      v_uyari := v_uyari || 'Bu hafta hiç satış girilmemiş: satılanlar kayıp gibi görünüyor. Girişler''den satışları gir.'::text;
    end if;
    select count(*) into v_say from (
      select tarih from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null
        and tarih > v_baslangic and tarih <= s2.tarih group by tarih having count(*) > 1) x;
    if v_say > 0 then
      v_uyari := v_uyari || format('%s gün için iki satış girişi var. Aynı satış iki kez girildiyse Girişler''den birini iptal et.', v_say);
    end if;
  end if;

  return jsonb_build_object(
    'durum', 'tamam',
    'sayim_id', s2.id, 'bitis', s2.tarih, 'baslangic', v_baslangic,
    'satirlar', v_satirlar,
    'toplam_acik_tl', (select coalesce(sum((x ->> 'fark_tl')::numeric), 0) from jsonb_array_elements(v_satirlar) x
                       where (x ->> 'fark_tl')::numeric < 0),
    'toplam_fazla_tl', (select coalesce(sum((x ->> 'fark_tl')::numeric), 0) from jsonb_array_elements(v_satirlar) x
                        where (x ->> 'fark_tl')::numeric > 0),
    'uyarilar', to_jsonb(v_uyari),
    'sayimlar', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tarih', tarih) order by tarih desc, olusturma desc), '[]')
                 from (select id, tarih, olusturma from girisler
                       where mekan_id = v_mekan and tur = 'sayim' and iptal_zamani is null
                       order by tarih desc, olusturma desc limit 26) x));
end $$;
