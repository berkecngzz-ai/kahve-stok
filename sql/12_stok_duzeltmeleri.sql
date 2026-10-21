-- 12: Stok güvenilirliği düzeltmeleri (2026-10-21 denetiminden).
-- 11_acik_yetkiler.sql'den SONRA çalıştırılır. Yeni tablo YOK; yalnız fonksiyonlar. Veri değiştirmez.
--   1) Kurulumda bağlanan satır da fiyat/miktar kontrolünden geçer (önce kontrolsüz stoğa giriyordu:
--      "SODA 200ML × 24" çarpan 1 ile 24 ml girdi, fiyat 14.500 ₺/litre oldu).
--   2) Patron bir faturayı Girişler'den iptal edince bağlı belge de iptal olur (önce belge açık kalıyor,
--      düzeltilmiş fatura yeniden yüklenince "daha önce yüklenmiş" diye reddediliyordu).
--   3) Satış raporu kurulumda ürün adetleriyle satış girişine çevrilir (stoğa işlenir).
--   4) Stok farkı raporu: iki sayım arasında beklenen ve sayılan stok, fark ve TL karşılığı.

-- ---------- 1) Kurulum: fiyat / miktar kontrolü ----------
-- Eski imza (onaysız) kaldırılır; yeni parametre p_onay varsayılan false, eski çağrılar aynen çalışır.
drop function if exists public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean);

create or replace function public.kurulum_satir_coz(p_satir bigint, p_sonuc text, p_malzeme uuid, p_carpan numeric,
                                                    p_miktar numeric, p_tutar_haric numeric, p_kdv_orani numeric,
                                                    p_deftere_yaz boolean, p_onay boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  s belge_satirlari;
  b belgeler;
  m malzemeler;
  v_stok numeric;
  v_sebep text;
  v_birim_fiyat numeric;
  v_fiyat_birimi text;
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
    select * into m from malzemeler where id = p_malzeme and mekan_id = s.mekan_id;
    if not found then raise exception 'Malzeme bu mekana ait değil.'; end if;
    if p_carpan is null or p_carpan <= 0 or p_carpan > 1000000 then raise exception 'Çarpanı yaz (1 belge birimi = kaç g/ml/adet).'; end if;
    s.miktar := coalesce(p_miktar, s.miktar);
    s.tutar_haric := coalesce(p_tutar_haric, s.tutar_haric);
    s.kdv_orani := coalesce(p_kdv_orani, s.kdv_orani);
    if s.miktar is null or s.miktar <= 0 then raise exception 'Miktarı yaz.'; end if;
    if s.tutar_haric is null or s.tutar_haric < 0 or s.kdv_orani is null or s.kdv_orani not between 0 and 100 then
      raise exception 'Tutarı ve KDV oranını yaz.';
    end if;
    v_stok := round(s.miktar * p_carpan, 3);
    -- Baristanın yolundaki kontrolün aynısı: bilinen fiyattan %30 sapma ya da geçmişin 3 katı miktar.
    -- Kurulum onaylarsa (gerçekten zam/indirim, büyük sipariş) geçer.
    v_sebep := satir_olagandisi(s.mekan_id, p_malzeme, v_stok, s.tutar_haric, s.kdv_orani);
    if v_sebep is not null and not coalesce(p_onay, false) then
      v_fiyat_birimi := case m.birim when 'g' then 'kg' when 'ml' then 'litre' else 'adet' end;
      if v_sebep = 'fiyat' then
        v_birim_fiyat := s.tutar_haric * (1 + s.kdv_orani / 100) / v_stok * (case m.birim when 'adet' then 1 else 1000 end);
        raise exception 'Fiyat tutmuyor: bu bağlamayla % için % ₺/% çıkıyor, kayıtlı fiyat % ₺/%. Çarpanı ve miktarı kontrol et (ör. 1 şişe = 200 ml). Doğruysa "Fiyat/miktar doğru" kutusunu işaretleyip tekrar bağla.',
          m.ad, translate(to_char(round(v_birim_fiyat, 2), 'FM999G999G990D00'), ',.', '.,'), v_fiyat_birimi,
          translate(to_char(m.fiyat, 'FM999G999G990D00'), ',.', '.,'), v_fiyat_birimi;
      else
        raise exception 'Miktar olağandışı: % için % % stoğa girecek, önceki faturaların 3 katından fazla ya da üçte birinden az. Çarpanı ve miktarı kontrol et. Doğruysa "Fiyat/miktar doğru" kutusunu işaretleyip tekrar bağla.',
          m.ad, rtrim(rtrim(translate(to_char(v_stok, 'FM999G999G990D000'), ',.', '.,'), '0'), ','), m.birim;
      end if;
    end if;
    update belge_satirlari
      set durum = 'stokta', bekleme_sebebi = null, malzeme_id = p_malzeme, carpan = p_carpan,
          miktar = round(s.miktar, 3), tutar_haric = round(s.tutar_haric, 2), kdv_orani = s.kdv_orani,
          stok_miktari = v_stok, cozen = 'kurulum', cozum_zamani = now()
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
end $$;

-- ---------- 2) İptal: giriş iptal edilince bağlı belge de iptal ----------
create or replace function public.giris_iptal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- ---------- 3) Satış raporu → satış girişi ----------
-- Kurulum kuyruğu artık her mekanın aktif ürünlerini de döndürür (satış raporu formu için).
create or replace function public.kurulum_kuyrugu() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'mekan_id', k.id, 'mekan', k.ad,
      'malzemeler', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'ad', m.ad, 'birim', m.birim) order by m.ad), '[]')
                     from malzemeler m where m.mekan_id = k.id and m.aktif),
      'urunler', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'ad', u.ad) order by u.ad), '[]')
                  from urunler u where u.mekan_id = k.id and u.aktif),
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
end $$;

-- Kurulum, satış raporundaki ürün adetlerini yazar → mekanın satış girişi olur (tarifle malzemeye çevrilir, sabitlenir),
-- rapor "tamam" olur ve girişe bağlanır. İkram / 0 TL satırlar da adet olarak yazılır (malzeme yine harcandı).
-- p_tarih: raporun kapsadığı son gün (genelde sayım günü). Aynı güne ikinci satış girişi çift sayım olur → reddedilir.
-- p_kalemler: [{"urun_id": "...", "miktar": 48}, ...]
create or replace function public.kurulum_satis_raporu_isle(p_belge uuid, p_tarih date, p_kalemler jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b belgeler;
  v_id uuid;
  v_onceki girisler;
  k jsonb;
  v_urun uuid;
  v_miktar numeric;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  select * into b from belgeler where id = p_belge for update;
  if not found or b.tur <> 'satis_raporu' then raise exception 'Satış raporu bulunamadı.'; end if;
  if b.iptal_zamani is not null then raise exception 'Bu rapor iptal edilmiş.'; end if;
  if b.durum <> 'bekliyor' then raise exception 'Bu rapor zaten işlenmiş.'; end if;
  if p_tarih is null then raise exception 'Raporun tarihini seç.'; end if;
  if p_tarih > bugun() then raise exception 'Tarih bugünden ileri olamaz.'; end if;
  if p_tarih < bugun() - 366 then raise exception 'Tarih en fazla bir yıl geriye gidebilir.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir ürünün adedini yaz.';
  end if;
  if jsonb_array_length(p_kalemler) > 300 then raise exception 'Bir raporda en fazla 300 satır olabilir.'; end if;

  select * into v_onceki from girisler
    where mekan_id = b.mekan_id and tur = 'satis' and tarih = p_tarih and iptal_zamani is null limit 1;
  if found then
    raise exception 'Bu mekana % için satış zaten girilmiş (%). Çift sayılmasın diye kaydedilmedi; önce o kaydı patron iptal etmeli.',
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

  update belgeler set durum = 'tamam', giris_id = v_id where id = p_belge;
  return v_id;
end $$;

-- ---------- 4) Stok farkı raporu ----------
-- Seçilen sayım (yoksa en son sayım) ile her malzemenin bir önceki sayımı arasındaki dönem:
--   beklenen = önceki sayım + gelen (fatura) − satış (tarifle) − fire
--   fark     = sayılan − beklenen   (eksi: açık / kayıp · artı: fazla)
-- Kural: sayım GÜN SONU sayılır. Sayım günündeki fatura, satış ve fire o sayımdan ÖNCE kabul edilir
-- (önceki sayımın günündekiler ise önceki döneme aittir). Tarih olarak girişin tarihi kullanılır
-- (fatura: belge tarihi, satış: rapor günü).
-- TL karşılığı malzemenin güncel fiyatıyla (KDV dahil) hesaplanır. Yalnız patron (fiyat içerir).
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
  select count(*) into v_say from belgeler
    where mekan_id = v_mekan and tur = 'fatura' and durum = 'bekliyor' and iptal_zamani is null;
  if v_say > 0 then
    v_uyari := v_uyari || format('%s fatura eşleştirme bekliyor: gelen mal eksik sayılmış olabilir, açık olduğundan büyük görünebilir.', v_say);
  end if;
  select count(*) into v_say from belgeler
    where mekan_id = v_mekan and tur = 'satis_raporu' and durum = 'bekliyor' and iptal_zamani is null;
  if v_say > 0 then
    v_uyari := v_uyari || format('%s satış raporu henüz işlenmedi: satışlar eksik sayılmış olabilir, fazla görünen malzemeler aslında satılmış olabilir.', v_say);
  end if;
  if v_baslangic is not null then
    if not exists (select 1 from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null
                   and tarih > v_baslangic and tarih <= s2.tarih) then
      v_uyari := v_uyari || 'Bu dönem için hiç satış girilmemiş: satılan her şey "fazla" görünür.'::text;
    end if;
    select count(*) into v_say from (
      select tarih from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null
        and tarih > v_baslangic and tarih <= s2.tarih group by tarih having count(*) > 1) x;
    if v_say > 0 then
      v_uyari := v_uyari || format('%s günde birden fazla satış girişi var: aynı satış iki kez girildiyse açık büyük görünür. Girişler''den kontrol et.', v_say);
    end if;
  end if;
  if exists (select 1 from jsonb_array_elements(v_satirlar) x where x ->> 'durum' = 'tamam' and (x ->> 'fiyat')::numeric <= 0) then
    v_uyari := v_uyari || 'Fiyatı girilmemiş malzemelerin TL karşılığı hesaplanamadı.'::text;
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

-- ---------- Yetkiler ----------
revoke all on function public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean, boolean),
  public.giris_iptal(uuid), public.kurulum_kuyrugu(), public.kurulum_satis_raporu_isle(uuid, date, jsonb),
  public.stok_farki(uuid)
  from public, anon, authenticated;
grant execute on function public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean, boolean),
  public.giris_iptal(uuid), public.kurulum_kuyrugu(), public.kurulum_satis_raporu_isle(uuid, date, jsonb),
  public.stok_farki(uuid)
  to authenticated;
