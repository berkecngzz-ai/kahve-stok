-- 26'yı geri alır: işlevler 26'dan önceki canlı hâline döner (2026-10-26 canlıdan alındı). Yeni tablolar
-- (tarif_surumleri, satis_satirlari) zararsız kalır; yeni işlevler silinir. Önce yedek al.
begin;
drop function if exists public.satis_raporu_isle(uuid, jsonb, jsonb);
drop function if exists public.urun_kaydet(uuid, text, jsonb, date);
drop function if exists public.fatura_teslim_tarihi(uuid, date);
drop function if exists public.sayim_duzelt(uuid, uuid, numeric, text);
drop function if exists public.tarifsiz_satislar();
CREATE OR REPLACE FUNCTION public.acik_trendi(p_adet integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mekan uuid := benim_mekanim();
  s record;
  r jsonb;
  v_sonuc jsonb := '[]';
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Açık trendini yalnızca patron görebilir.'; end if;
  for s in
    select id from (
      select distinct on (tarih) id, tarih from girisler
      where mekan_id = v_mekan and tur = 'sayim' and iptal_zamani is null
      order by tarih desc, olusturma desc) x
    order by tarih desc limit least(greatest(coalesce(p_adet, 8), 1), 26)
  loop
    r := stok_farki(s.id);
    continue when r ->> 'baslangic' is null;        -- ilk sayım: karşılaştıracak önceki sayım yok
    v_sonuc := v_sonuc || jsonb_build_object(
      'sayim_id', s.id, 'baslangic', r -> 'baslangic', 'bitis', r -> 'bitis',
      'acik_tl', r -> 'toplam_acik_tl', 'fazla_tl', r -> 'toplam_fazla_tl',
      'uyarilar', r -> 'uyarilar',
      'en_cok_acik', coalesce((
        select jsonb_agg(x order by (x ->> 'fark_tl')::numeric) from (
          select x from jsonb_array_elements(r -> 'satirlar') x
          where x ->> 'durum' = 'tamam' and (x ->> 'fark_tl')::numeric < 0
          order by (x ->> 'fark_tl')::numeric limit 3) t), '[]'::jsonb));
  end loop;
  return v_sonuc;   -- en yeni dönem başta
end $function$
;

CREATE OR REPLACE FUNCTION public.barista_durumu()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('bugun', bugun(),
    'son_sayim', (select max(tarih) from girisler where mekan_id = benim_mekanim() and tur = 'sayim' and iptal_zamani is null))
  where benim_mekanim() is not null
$function$
;

CREATE OR REPLACE FUNCTION public.giris_iptal(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g girisler;
  v_ad text;
begin
  select * into g from girisler where id = p_id and mekan_id = benim_mekanim() for update;
  if not found then raise exception 'Kayıt bulunamadı.'; end if;
  if g.iptal_zamani is not null then raise exception 'Bu kayıt zaten iptal edilmiş.'; end if;
  if not patron_muyum() and (g.giren is distinct from auth.uid()
      or (g.olusturma at time zone 'Europe/Istanbul')::date <> bugun()) then
    raise exception 'Barista yalnızca kendi girdiği kaydı aynı gün iptal edebilir. Bu kaydı patron iptal edebilir.';
  end if;
  v_ad := coalesce((select ad from uyeler where user_id = auth.uid()), '?');
  update girisler set iptal_eden = auth.uid(), iptal_eden_ad = v_ad, iptal_zamani = now() where id = p_id;
  -- Bu girişi oluşturan belge (fatura fotoğrafı/PDF, satış raporu) da iptal: aynı belge düzeltilip yeniden yüklenebilsin.
  update belgeler set iptal_eden = auth.uid(), iptal_eden_ad = v_ad, iptal_zamani = now()
    where giris_id = p_id and mekan_id = g.mekan_id and iptal_zamani is null;
  if g.tur = 'fatura' then
    perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = p_id and malzeme_id is not null;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.kurulum_satis_raporu_isle(p_belge uuid, p_tarih date, p_kalemler jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return satis_raporu_isle(p_belge, p_tarih, p_kalemler, '[]');
end $function$
;

CREATE OR REPLACE FUNCTION public.satis_raporu_isle(p_belge uuid, p_tarih date, p_kalemler jsonb, p_eslesmeler jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b belgeler;
  v_id uuid;
  v_onceki girisler;
  k jsonb;
  v_urun uuid;
  v_miktar numeric;
  v_ad text;
  v_kurulum boolean := kurulumcu_muyum();
begin
  select * into b from belgeler where id = p_belge for update;
  -- Başka mekanın raporu "yok" sayılır (varlığı da sızmasın).
  if not found or b.tur <> 'satis_raporu' or (not v_kurulum and b.mekan_id is distinct from benim_mekanim()) then
    raise exception 'Satış raporu bulunamadı.';
  end if;
  if not v_kurulum and not patron_muyum() then raise exception 'Satış raporunu yalnız patron işleyebilir.'; end if;
  if b.iptal_zamani is not null then raise exception 'Bu rapor iptal edilmiş.'; end if;
  if b.durum <> 'bekliyor' then raise exception 'Bu rapor zaten işlenmiş.'; end if;
  if p_tarih is null then raise exception 'Raporun tarihini seç.'; end if;
  if p_tarih > bugun() then raise exception 'Tarih bugünden ileri olamaz.'; end if;
  if p_tarih < bugun() - 366 then raise exception 'Tarih en fazla bir yıl geriye gidebilir.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Raporda menüdeki ürünlerden hiçbiri yok.';
  end if;
  if jsonb_array_length(p_kalemler) > 300 then raise exception 'Bir raporda en fazla 300 satır olabilir.'; end if;
  if p_eslesmeler is not null and jsonb_typeof(p_eslesmeler) is distinct from 'array' then raise exception 'Geçersiz eşleşme.'; end if;
  if jsonb_array_length(coalesce(p_eslesmeler, '[]')) > 300 then raise exception 'Çok fazla eşleşme.'; end if;

  select * into v_onceki from girisler
    where mekan_id = b.mekan_id and tur = 'satis' and tarih = p_tarih and iptal_zamani is null limit 1;
  if found then
    raise exception 'Bu mekana % için satış zaten girilmiş (%). Çift sayılmasın diye kaydedilmedi; önce o kaydı iptal et.',
      to_char(p_tarih, 'DD.MM.YYYY'), v_onceki.giren_ad;
  end if;

  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad)
    values (b.mekan_id, 'satis', p_tarih, 'Satış raporu', auth.uid(),
            coalesce((select ad from uyeler where user_id = auth.uid()), 'Kurulum'))
    returning id into v_id;

  for k in select value from jsonb_array_elements(p_kalemler) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = b.mekan_id;
    if v_urun is null then raise exception 'Satırlarda bu mekana ait olmayan bir ürün var.'; end if;
    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then (k ->> 'miktar')::numeric end;
    if v_miktar is null or v_miktar <> trunc(v_miktar) or v_miktar not between 1 and 100000 then
      raise exception 'Ürün adetleri 1 ile 100.000 arasında tam sayı olmalı.';
    end if;
    insert into giris_kalemleri (giris_id, mekan_id, urun_id, miktar) values (v_id, b.mekan_id, v_urun, v_miktar);
  end loop;
  if exists (select 1 from giris_kalemleri where giris_id = v_id group by urun_id having count(*) > 1) then
    raise exception 'Aynı ürün iki satırda var. Tek satırda topla.';
  end if;

  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    select v_id, b.mekan_id, t.malzeme_id, sum(t.miktar * gk.miktar)
    from giris_kalemleri gk join tarif_kalemleri t on t.urun_id = gk.urun_id
    where gk.giris_id = v_id
    group by t.malzeme_id;

  -- Patronun seçtiği eşleşmeler hatırlanır (aynı kasa adı bir sonraki raporda sorulmaz).
  for k in select value from jsonb_array_elements(coalesce(p_eslesmeler, '[]')) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz eşleşme.'; end if;
    v_ad := left(lower(trim(coalesce(k ->> 'ad', ''))), 200);
    if v_ad = '' then raise exception 'Geçersiz eşleşme.'; end if;
    v_urun := null;
    if k ->> 'urun_id' is not null then
      select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = b.mekan_id;
      if v_urun is null then raise exception 'Eşleşmede bu mekana ait olmayan bir ürün var.'; end if;
    end if;
    insert into satis_eslesmeleri (mekan_id, ad_anahtar, urun_id) values (b.mekan_id, v_ad, v_urun)
      on conflict (mekan_id, ad_anahtar) do update set urun_id = excluded.urun_id, guncelleme = now();
  end loop;

  update belgeler set durum = 'tamam', giris_id = v_id where id = p_belge;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.stok_durumu()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mekan uuid := benim_mekanim();
  v_bugun date := bugun();
  v_gun int;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Stok durumunu yalnızca patron görebilir.'; end if;

  select case when min(tarih) is null then 0 else least(28, greatest(1, v_bugun - min(tarih) + 1)) end into v_gun
    from girisler where mekan_id = v_mekan and iptal_zamani is null;

  return jsonb_build_object('tarih', v_bugun, 'kullanim_gun', coalesce(v_gun, 0), 'malzemeler', coalesce((
    with son_sayim as (
      select distinct on (h.malzeme_id) h.malzeme_id, g.tarih, h.miktar
      from girisler g join malzeme_hareketleri h on h.giris_id = g.id
      where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
      order by h.malzeme_id, g.tarih desc, g.olusturma desc
    ),
    hareket as (
      select h.malzeme_id,
             coalesce(sum(h.miktar) filter (where g.tur = 'fatura' and g.tarih > s.tarih), 0) gelen,
             coalesce(sum(h.miktar) filter (where g.tur = 'satis' and g.tarih > s.tarih), 0) satis,
             coalesce(sum(h.miktar) filter (where g.tur = 'fire' and g.tarih > s.tarih), 0) fire,
             coalesce(sum(h.miktar) filter (where g.tur in ('satis', 'fire') and g.tarih > v_bugun - 28), 0) kullanim_28
      from malzeme_hareketleri h
      join girisler g on g.id = h.giris_id
      left join son_sayim s on s.malzeme_id = h.malzeme_id
      where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tur in ('fatura', 'satis', 'fire')
      group by h.malzeme_id
    ),
    satir as (
      select m.id, m.ad, m.birim, m.fiyat, s.tarih sayim_tarih, s.miktar sayilan,
             coalesce(hr.gelen, 0) gelen, coalesce(hr.satis, 0) satis, coalesce(hr.fire, 0) fire,
             case when s.malzeme_id is not null
                  then s.miktar + coalesce(hr.gelen, 0) - coalesce(hr.satis, 0) - coalesce(hr.fire, 0) end simdi,
             case when v_gun > 0 then coalesce(hr.kullanim_28, 0) / v_gun end gunluk
      from malzemeler m
      left join son_sayim s on s.malzeme_id = m.id
      left join hareket hr on hr.malzeme_id = m.id
      where m.mekan_id = v_mekan and m.aktif
    )
    select jsonb_agg(jsonb_build_object(
             'malzeme_id', id, 'ad', ad, 'birim', birim, 'fiyat', fiyat,
             'sayim_tarih', sayim_tarih, 'sayilan', sayilan, 'gelen', gelen, 'satis', satis, 'fire', fire,
             'simdi', simdi,
             'deger_tl', case when simdi is not null and fiyat > 0
                              then round(greatest(simdi, 0) * fiyat / (case birim when 'adet' then 1 else 1000 end), 2) end,
             'gunluk', round(gunluk, 3),
             'yeter_gun', case when simdi is not null and gunluk > 0 then floor(greatest(simdi, 0) / gunluk) end)
           order by (simdi is null), (case when gunluk > 0 then greatest(simdi, 0) / gunluk end) nulls last, ad)
    from satir), '[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.stok_farki(p_sayim uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.urun_kaydet(p_id uuid, p_ad text, p_kalemler jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_adet int;
begin
  if not patron_muyum() then raise exception 'Bu işlemi yalnızca patron yapabilir.'; end if;
  if coalesce(trim(p_ad), '') = '' then raise exception 'Ürün adı boş olamaz.'; end if;
  if length(trim(p_ad)) > 60 then raise exception 'Ürün adı en fazla 60 karakter olabilir.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Tarife en az bir malzeme ekle.';
  end if;
  if jsonb_array_length(p_kalemler) > 50 then raise exception 'Bir tarifte en fazla 50 malzeme olabilir.'; end if;

  -- Her kalem: bu mekana ait bir malzeme ve 0'dan büyük bir miktar olmalı.
  if exists (
    select 1 from jsonb_array_elements(p_kalemler) k
    where coalesce(case when jsonb_typeof(k -> 'miktar') = 'number'
                        then (k ->> 'miktar')::numeric end, 0) not between 0.001 and 99999.999
  ) then
    raise exception 'Tarifteki miktarlar 0''dan büyük bir sayı olmalı.';
  end if;
  select count(distinct m.id) into v_adet
    from jsonb_array_elements(p_kalemler) k
    join malzemeler m on m.id::text = k ->> 'malzeme_id' and m.mekan_id = benim_mekanim();
  if v_adet <> jsonb_array_length(p_kalemler) then
    raise exception 'Tarifte geçersiz ya da iki kez yazılmış bir malzeme var.';
  end if;

  begin
    if p_id is null then
      insert into urunler (ad) values (trim(p_ad)) returning id into v_id;
    else
      update urunler set ad = trim(p_ad)
        where id = p_id and mekan_id = benim_mekanim() returning id into v_id;
      if v_id is null then raise exception 'Ürün bulunamadı.'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Bu adla bir ürün zaten var.';
  end;

  delete from tarif_kalemleri where urun_id = v_id;
  insert into tarif_kalemleri (urun_id, malzeme_id, miktar)
    select v_id, (k ->> 'malzeme_id')::uuid, round((k ->> 'miktar')::numeric, 3)
    from jsonb_array_elements(p_kalemler) k;
  return v_id;
end $function$
;

drop function if exists public.satis_gunu_yenile(uuid, date, uuid, text);
drop function if exists public.malzeme_birim_maliyet(uuid, date);
drop function if exists public.tarif_gecerli(uuid, date);
grant execute on function public.satis_raporu_isle(uuid, date, jsonb, jsonb) to authenticated;
commit;
