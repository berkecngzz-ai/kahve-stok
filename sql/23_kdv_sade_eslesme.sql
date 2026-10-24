-- 23: KDV kullanıcıdan gizlenir, eşleşmeyen fatura satırı sessizce geçilir (2026-10-24).
-- 22_gunluk_kontrol.sql'den SONRA çalıştırılır. Mevcut veriyi DEĞİŞTİRMEZ: yalnız boş başlayan sütunlar,
-- genişletilen kısıtlar ve yeni/yenilenen işlevler. Yeni tablo yok.
-- Geri dönüş: scripts/geri-al-23.sql
--
-- Kurallar (kullanıcıyla kararlaştırıldı):
--   * Kimse KDV oranı / matrah girmez. Faturadan okunan vergi bilgisi saklanır ve hesapta kullanılır; belirsizse
--     oran UYDURULMAZ (varsayılan oran yok). Fiyatlar her yerde KDV dahildir.
--   * KDV dahil tutarı bilinmeyen satır stoğu DURDURMAZ: tanınmış satır stoğa girer, fiyatı "kontrol bekliyor"
--     olur (giris_kalemleri.uyarilar 'fiyat_kontrol'); malzemenin fiyatı değişmez, son onaylı fiyat kalır.
--   * Toplamı tutmayan faturada barista saydığı (fiziksel olarak doğrulanmış) satırlar stoğa girer, fiyatları
--     kontrol bekler; sayılmayan satırlar eskisi gibi kurulumu bekler. Kullanıcıya vergi sorusu sorulmaz.
--   * Mekânın stok listesinde karşılığı olmayan satır (sınıf 'belirsiz') stoğa girmez, sessizce geçilir
--     (cozen 'eslesmedi'); kurulum hesabı isterse geri alabilir. Otomatik yeni malzeme açılmaz.
--   * Patron kontrol bekleyen fiyatı tek alanla kapatır: faturadaki tutar (KDV dahil) ya da "kayıtlı fiyat doğru".

-- ---------- 1) Şema: yalnız ekleme ----------
-- tutar_dahil  : satırın belgede yazan KDV dahil tutarı (fişlerde). Faturada hariç tutar + oran varsa boş kalır.
-- fiyat_kontrol: satır stoğa girdi ama fiyatı doğrulanamadı (KDV belirsiz ya da toplam tutmadı).
alter table public.belge_satirlari
  add column tutar_dahil   numeric(14,2) check (tutar_dahil >= 0),
  add column fiyat_kontrol boolean not null default false;
alter table public.belge_satirlari drop constraint belge_satirlari_cozen_check;
alter table public.belge_satirlari add constraint belge_satirlari_cozen_check
  check (cozen in ('otomatik', 'barista', 'kurulum', 'ai', 'eslesmedi'));
-- Giriş kalemi hangi fatura satırından geldi (fiyat onayında faturadaki miktar için).
alter table public.giris_kalemleri add column belge_satir_id bigint references public.belge_satirlari(id);
create index giris_kalemleri_fiyat_kontrol_idx on public.giris_kalemleri(mekan_id) where 'fiyat_kontrol' = any(uyarilar);
alter table public.islem_gecmisi drop constraint islem_gecmisi_tur_check;
alter table public.islem_gecmisi add constraint islem_gecmisi_tur_check
  check (tur in ('giris', 'giris_iptal', 'belge_iptal', 'mal_kabul', 'teslimat_farki', 'fark_cozuldu', 'fiyat_onay'));

-- Satırın KDV dahil tutarı: belgede yazan dahil tutar; yoksa hariç tutar + okunan oran; ikisi de yoksa bilinmez (null).
create or replace function public.satir_dahil_tutar(p_dahil numeric, p_haric numeric, p_oran numeric) returns numeric
language sql immutable as $$
  select coalesce(p_dahil, case when p_haric is not null and p_oran is not null then round(p_haric * (1 + p_oran / 100), 2) end)
$$;

-- ---------- 2) Stoğa ekleme ----------
-- 21'deki işlevin aynısı; değişenler: KDV dahil tutar satir_dahil_tutar ile; fiyatı doğrulanmayan satır stoğa girer
-- ama fiyat geçmişine yazılmaz, giriş kalemi 'fiyat_kontrol' işaretlenir; kalem hangi satırdan geldiğini tutar.
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
      values (b.mekan_id, 'fatura', least(coalesce(b.belge_tarihi, (b.olusturma at time zone 'Europe/Istanbul')::date),
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

-- ---------- 3) Belge kaydetme ----------
-- 21'deki işlevin aynısı; değişenler:
--   * satır 'tutar_dahil' alır; satır tutarı satir_dahil_tutar ile (bilinmeyen oran %0 SAYILMAZ)
--   * KDV dahil tutarı bilinmeyen satır 'eksik' diye beklemez: stoğa girer, fiyatı kontrol bekler
--   * toplam: genel toplam tutuyor YA DA (KDV belirsizken) satırların hariç toplamı faturadaki hariç toplamı tutuyor
--   * toplam tutmuyorsa sayılan satırlar yine stoğa girer (fiyat kontrol bekler); sayılmayanlar kurulumu bekler
--   * sınıf 'belirsiz' (stok listesinde karşılığı yok) → stoğa girmez, sessizce geçilir ('eslesmedi')
--   * 'carpan_sayimdan': çarpan baristanın stok biriminde saydığından çıktıysa deftere yazılmaz
create or replace function public.belge_kaydet(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mekan   uuid := benim_mekanim();
  v_ad      text;
  v_id      uuid;
  v_istek   uuid;
  v_tur     text;
  v_kaynak  text;
  v_ozet    text;
  v_ettn    text;
  v_no      text;
  v_ted     text;
  v_vkn     text;
  v_tedanah text;
  v_tarih   date;
  v_genel   numeric; v_thar numeric; v_tkdv numeric; v_ind numeric;
  v_sum     numeric := 0;                  -- satırların KDV dahil toplamı (bilinenler)
  v_sum_har numeric := 0;                  -- satırların KDV hariç toplamı (bilinenler)
  v_dahil_eksik boolean := false;          -- KDV dahil tutarı bilinmeyen satır var
  v_haric_eksik boolean := false;          -- KDV hariç tutarı bilinmeyen satır var
  v_pay     numeric;
  v_tutuyor boolean;
  v_onceki  belgeler;
  k         jsonb;
  v_sira    int := 0;
  v_metin   text; v_manah text; v_miktar numeric; v_birim text; v_bfiyat numeric; v_haric numeric; v_oran numeric;
  v_dahil   numeric; v_ldahil numeric;
  v_sinif   text; v_mal uuid; v_carpan numeric; v_aday uuid; v_onay boolean; v_sayimdan boolean;
  v_durum   text; v_sebep text; v_cozen text; v_stok numeric; v_defter eslestirme_defteri;
  v_satir   bigint;
  v_yol     text;
  v_say_stok int := 0; v_say_bekle int := 0; v_say_disi int := 0;
  v_ai      uuid;
  v_gelen   numeric; v_sayim text; v_teslimat text; v_okunan numeric; v_not text;
  v_fstok   numeric;                       -- faturadaki miktar, stok biriminde
  v_kalemler jsonb := '[]'::jsonb;         -- işlem geçmişi için sayım özeti
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  select ad into v_ad from uyeler where user_id = auth.uid();
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Geçersiz istek.'; end if;

  begin v_istek := (p ->> 'istek_id')::uuid; exception when others then v_istek := null; end;
  if v_istek is null then raise exception 'Geçersiz istek.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_mekan::text || v_istek::text, 0));
  select * into v_onceki from belgeler where mekan_id = v_mekan and istek_id = v_istek;
  if found then
    return jsonb_build_object('id', v_onceki.id, 'durum', v_onceki.durum, 'tekrar', true,
      'stoklanan', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'stokta'),
      'bekleyen', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'bekliyor'),
      'takip_disi', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'takip_disi'));
  end if;

  -- AI okuması: bu mekana ait, tamamlanmış ve daha önce başka belgeye bağlanmamış olmalı
  begin v_ai := (p ->> 'ai_okuma_id')::uuid; exception when others then v_ai := null; end;
  if v_ai is not null then
    update ai_okumalari set kullanildi = true
      where id = v_ai and mekan_id = v_mekan and durum = 'tamam' and not kullanildi;
    if not found then v_ai := null; end if;
  end if;

  v_tur := coalesce(p ->> 'tur', 'fatura');
  if v_tur not in ('fatura', 'satis_raporu') then raise exception 'Geçersiz belge türü.'; end if;
  v_kaynak := p ->> 'kaynak';
  if v_kaynak is null or v_kaynak not in ('xml', 'pdf', 'ocr', 'elle', 'dosya', 'ai') then raise exception 'Geçersiz belge kaynağı.'; end if;
  if v_kaynak = 'ai' and v_ai is null then v_kaynak := 'ocr'; end if;
  v_ozet := nullif(lower(p ->> 'dosya_ozeti'), '');
  if v_ozet is not null and v_ozet !~ '^[0-9a-f]{64}$' then v_ozet := null; end if;
  v_ettn := nullif(left(trim(p ->> 'ettn'), 64), '');
  v_no   := nullif(left(upper(trim(p ->> 'fatura_no')), 64), '');
  v_ted  := nullif(left(trim(p ->> 'tedarikci'), 200), '');
  v_vkn  := nullif(regexp_replace(coalesce(p ->> 'tedarikci_vkn', ''), '\D', '', 'g'), '');
  if v_vkn is not null and v_vkn !~ '^[0-9]{10,11}$' then v_vkn := null; end if;
  v_tedanah := coalesce(v_vkn, nullif(metin_anahtari(v_ted), ''), '');
  begin v_tarih := (p ->> 'tarih')::date; exception when others then v_tarih := null; end;
  if v_tarih > bugun() or v_tarih < bugun() - 400 then v_tarih := null; end if;

  select * into v_onceki from belgeler
    where mekan_id = v_mekan and iptal_zamani is null
      and ((v_ozet is not null and dosya_ozeti = v_ozet)
        or (v_ettn is not null and ettn = v_ettn)
        or (v_no is not null and v_tedanah <> '' and tedarikci_anahtar = v_tedanah and fatura_no = v_no))
    limit 1;
  if found then
    raise exception 'Bu belge daha önce yüklenmiş (% tarihinde, %).',
      to_char(v_onceki.olusturma at time zone 'Europe/Istanbul', 'DD.MM.YYYY'), v_onceki.giren_ad;
  end if;

  if v_tur = 'fatura' then
    if jsonb_typeof(p -> 'toplamlar') is distinct from 'object' then raise exception 'Faturanın en altındaki toplamı yaz.'; end if;
    v_genel := case when jsonb_typeof(p -> 'toplamlar' -> 'genel') = 'number' then (p -> 'toplamlar' ->> 'genel')::numeric end;
    v_thar  := case when jsonb_typeof(p -> 'toplamlar' -> 'kdv_haric') = 'number' then (p -> 'toplamlar' ->> 'kdv_haric')::numeric end;
    v_tkdv  := case when jsonb_typeof(p -> 'toplamlar' -> 'kdv') = 'number' then (p -> 'toplamlar' ->> 'kdv')::numeric end;
    v_ind   := coalesce(case when jsonb_typeof(p -> 'toplamlar' -> 'indirim') = 'number' then (p -> 'toplamlar' ->> 'indirim')::numeric end, 0);
    if v_genel is null or v_genel < 0 or v_genel >= 1000000000 then raise exception 'Faturanın en altındaki toplamı yaz.'; end if;
    if coalesce(v_thar, 0) not between 0 and 999999999 or coalesce(v_tkdv, 0) not between 0 and 999999999
       or v_ind not between 0 and 999999999 then
      raise exception 'Fatura toplamları geçersiz.';
    end if;
    if jsonb_typeof(p -> 'satirlar') is distinct from 'array' or jsonb_array_length(p -> 'satirlar') = 0 then
      raise exception 'Faturada okunabilen satır yok. Fotoğrafı tekrar çek.';
    end if;
    if jsonb_array_length(p -> 'satirlar') > 300 then raise exception 'Bir faturada en fazla 300 satır olabilir.'; end if;

    if not coalesce((p ->> 'ayni_olabilir_onay')::boolean, false) then
      select * into v_onceki from belgeler
        where mekan_id = v_mekan and iptal_zamani is null and tur = 'fatura'
          and tedarikci_anahtar = v_tedanah and v_tedanah <> '' and belge_tarihi = v_tarih and genel_toplam = round(v_genel, 2)
        limit 1;
      if found then
        raise exception 'Bu fatura daha önce yüklenmiş olabilir (% tarihinde, %).',
          to_char(v_onceki.olusturma at time zone 'Europe/Istanbul', 'DD.MM.YYYY'), v_onceki.giren_ad;
      end if;
    end if;
  end if;

  insert into belgeler (mekan_id, tur, kaynak, istek_id, dosya_ozeti, ettn, fatura_no, tedarikci, tedarikci_vkn,
                        tedarikci_anahtar, belge_tarihi, genel_toplam, kdv_haric_toplam, kdv_toplam, indirim,
                        okunan, durum, giren, giren_ad, ai_okuma_id)
    values (v_mekan, v_tur, v_kaynak, v_istek, v_ozet, v_ettn, v_no, v_ted, v_vkn, v_tedanah, v_tarih,
            round(v_genel, 2), round(v_thar, 2), round(v_tkdv, 2), round(v_ind, 2),
            case when jsonb_typeof(p -> 'okunan') = 'object' and pg_column_size(p -> 'okunan') < 300000
                 then p -> 'okunan' end,
            'bekliyor', auth.uid(), coalesce(v_ad, '?'), v_ai)
    returning id into v_id;

  if jsonb_typeof(p -> 'dosyalar') = 'array' then
    if jsonb_array_length(p -> 'dosyalar') > 6 then raise exception 'Bir belgeye en fazla 6 dosya eklenebilir.'; end if;
    for v_yol in select value from jsonb_array_elements_text(p -> 'dosyalar') loop
      if split_part(v_yol, '/', 1) <> v_mekan::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'fatura-belgeleri' and o.name = v_yol) then
        raise exception 'Belge dosyası bulunamadı. Tekrar dene.';
      end if;
      if exists (select 1 from belge_dosyalari where yol = v_yol) or exists (select 1 from giris_belgeleri where yol = v_yol) then
        raise exception 'Bu dosya başka bir belgeye bağlı.';
      end if;
      insert into belge_dosyalari (belge_id, mekan_id, yol, tur)
        values (v_id, v_mekan, v_yol, case when lower(v_yol) like '%.pdf' then 'pdf'
                                            when lower(v_yol) like '%.xml' then 'xml'
                                            when lower(v_yol) ~ '\.(jpg|jpeg|png|webp)$' then 'foto' else 'diger' end);
    end loop;
  end if;

  if v_tur = 'satis_raporu' then
    if not exists (select 1 from belge_dosyalari where belge_id = v_id) then raise exception 'Satış raporunun fotoğrafını ya da dosyasını ekle.'; end if;
    return jsonb_build_object('id', v_id, 'durum', 'bekliyor', 'stoklanan', 0, 'bekleyen', 0, 'takip_disi', 0, 'tekrar', false);
  end if;

  for k in select value from jsonb_array_elements(p -> 'satirlar') loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    v_sira := v_sira + 1;
    v_metin := left(trim(coalesce(k ->> 'metin', '')), 300);
    if v_metin = '' then v_metin := '(okunamadı)'; end if;
    v_manah := coalesce(nullif(metin_anahtari(v_metin), ''), '-');
    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' and (k ->> 'miktar')::numeric between 0 and 9999999999
                     then round((k ->> 'miktar')::numeric, 3) end;
    v_birim := case when k ->> 'birim' in ('adet', 'kg', 'g', 'lt', 'ml') then k ->> 'birim' else 'diger' end;
    v_bfiyat := case when jsonb_typeof(k -> 'birim_fiyat') = 'number' and (k ->> 'birim_fiyat')::numeric between 0 and 9999999999
                     then round((k ->> 'birim_fiyat')::numeric, 4) end;
    v_haric := case when jsonb_typeof(k -> 'tutar_haric') = 'number' and (k ->> 'tutar_haric')::numeric between 0 and 999999999
                    then round((k ->> 'tutar_haric')::numeric, 2) end;
    v_oran := case when jsonb_typeof(k -> 'kdv_orani') = 'number' and (k ->> 'kdv_orani')::numeric between 0 and 100
                   then (k ->> 'kdv_orani')::numeric end;
    v_dahil := case when jsonb_typeof(k -> 'tutar_dahil') = 'number' and (k ->> 'tutar_dahil')::numeric between 0 and 999999999
                    then round((k ->> 'tutar_dahil')::numeric, 2) end;
    v_ldahil := satir_dahil_tutar(v_dahil, v_haric, v_oran);
    v_sinif := k ->> 'sinif';
    v_mal := null; v_aday := null; v_carpan := null;
    begin v_mal := (k ->> 'malzeme_id')::uuid; exception when others then v_mal := null; end;
    begin v_aday := (k ->> 'aday_malzeme_id')::uuid; exception when others then v_aday := null; end;
    if v_mal is not null and not exists (select 1 from malzemeler where id = v_mal and mekan_id = v_mekan) then v_mal := null; end if;
    if v_aday is not null and not exists (select 1 from malzemeler where id = v_aday and mekan_id = v_mekan) then v_aday := null; end if;
    v_carpan := case when jsonb_typeof(k -> 'carpan') = 'number' and (k ->> 'carpan')::numeric between 0.000001 and 1000000
                     then (k ->> 'carpan')::numeric end;
    v_onay := coalesce(case when jsonb_typeof(k -> 'barista_onayi') = 'boolean' then (k ->> 'barista_onayi')::boolean end, false);
    v_sayimdan := coalesce(case when jsonb_typeof(k -> 'carpan_sayimdan') = 'boolean' then (k ->> 'carpan_sayimdan')::boolean end, false);
    -- Kör sayım: baristanın saydığı (belge birimiyle). Sayılmadıysa (dökme/tartılı) stok faturadaki kadar.
    v_gelen := case when jsonb_typeof(k -> 'gelen_miktar') = 'number' and (k ->> 'gelen_miktar')::numeric between 0 and 9999999999
                    then round((k ->> 'gelen_miktar')::numeric, 3) end;
    v_sayim := case when k ->> 'sayim' in ('sayildi', 'sayilmadi') then k ->> 'sayim' end;
    if v_sayim = 'sayilmadi' then v_gelen := null; end if;
    if v_gelen is not null then v_sayim := 'sayildi'; end if;
    v_teslimat := case when k ->> 'teslimat' in ('tam', 'okuma_hatasi', 'teslimat_farki', 'belirsiz') then k ->> 'teslimat' end;
    v_okunan := case when jsonb_typeof(k -> 'okunan_miktar') = 'number' and (k ->> 'okunan_miktar')::numeric between 0 and 9999999999
                     then round((k ->> 'okunan_miktar')::numeric, 3) end;
    v_not := nullif(left(trim(coalesce(k ->> 'barista_notu', '')), 300), '');
    v_sum := v_sum + coalesce(v_ldahil, 0);
    v_sum_har := v_sum_har + coalesce(v_haric, 0);
    if v_ldahil is null then v_dahil_eksik := true; end if;
    if v_haric is null then v_haric_eksik := true; end if;

    v_durum := 'bekliyor'; v_sebep := 'eslesme'; v_cozen := null; v_stok := null;
    if v_sinif = 'takip_disi' and exists (
         select 1 from eslestirme_defteri
         where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and sonuc = 'takip_disi'
           and tedarikci_anahtar in (v_tedanah, '')) then
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'otomatik'; v_mal := null;
    elsif v_sinif = 'takip_disi' and v_ai is not null and ai_takip_disi_mi(v_ai, v_mekan, v_sira, v_manah) then
      -- AI (sunucudaki kaydına göre) bu satır için emin olarak "takip dışı" demiş
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'ai'; v_mal := null;
    elsif v_sinif in ('takip_disi', 'belirsiz') then
      -- Mekânın stok listesinde karşılığı yok: stoğa girmez, sessizce geçilir (kurulum geri alabilir).
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'eslesmedi'; v_mal := null;
    elsif v_sinif = 'eslesti' and v_mal is not null and v_carpan is not null then
      select * into v_defter from eslestirme_defteri
        where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and sonuc = 'malzeme'
          and tedarikci_anahtar in (v_tedanah, '') and malzeme_id = v_mal and carpan = v_carpan
        order by (tedarikci_anahtar = v_tedanah) desc limit 1;
      if found then
        v_cozen := 'otomatik';
      elsif exists (select 1 from eslestirme_defteri
                    where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and kaynak = 'kurulum'
                      and tedarikci_anahtar in (v_tedanah, '')) then
        v_cozen := null;
      elsif v_onay then
        v_cozen := 'barista';
        -- Çarpan baristanın stok biriminde saydığından çıktıysa (paket içi bilinmiyordu) deftere yazılmaz:
        -- eksik gelen bir koli yanlış çarpan öğretmesin.
        if not v_sayimdan then
          insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, kaynak)
            values (v_mekan, v_tedanah, v_manah, v_birim, 'malzeme', v_mal, v_carpan, 'barista')
            on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
              set sonuc = 'malzeme', malzeme_id = excluded.malzeme_id, carpan = excluded.carpan,
                  kaynak = 'barista', guncelleme = now()
              where eslestirme_defteri.kaynak <> 'kurulum';
        end if;
      end if;
      if v_cozen is not null then
        if v_miktar is null or v_miktar = 0 then
          v_sebep := 'eksik';
        else
          v_fstok := round(v_miktar * v_carpan, 3);
          v_stok := round(coalesce(v_gelen, v_miktar) * v_carpan, 3);     -- stok SAYILAN kadar
          -- KDV dahil tutar bilinmiyorsa satır beklemez (fiyat kontrol bekler); yalnız miktar/fiyat şüphesi bekletir.
          if v_bfiyat is not null and v_haric is not null and abs(v_miktar * v_bfiyat - v_haric) > greatest(1, v_haric * 0.01) then
            v_sebep := 'tutar';
          else
            -- Dahil tutarla karşılaştırılır (oran 0 verilir: tutar zaten KDV dahil, hesap bunu ikinci kez eklemesin).
            v_sebep := satir_olagandisi(v_mekan, v_mal, v_fstok, v_ldahil, case when v_ldahil is not null then 0 end);
          end if;
        end if;
        if v_sebep is null then v_durum := 'stokta'; end if;
      else
        v_aday := coalesce(v_aday, v_mal); v_mal := null;
      end if;
    else
      v_aday := coalesce(v_aday, v_mal); v_mal := null;
    end if;
    if v_durum = 'bekliyor' and v_sebep = 'eslesme' then v_mal := null; v_stok := null; end if;

    insert into belge_satirlari (belge_id, mekan_id, sira, metin, metin_anahtar, miktar, birim, birim_fiyat, tutar_haric,
                                 kdv_orani, tutar_dahil, fiyat_kontrol, durum, bekleme_sebebi, aday_malzeme_id, malzeme_id,
                                 carpan, stok_miktari, cozen, cozum_zamani, gelen_miktar, sayim, teslimat, okunan_miktar,
                                 barista_notu)
      values (v_id, v_mekan, v_sira, v_metin, v_manah, v_miktar, v_birim, v_bfiyat, v_haric, v_oran, v_dahil,
              v_ldahil is null,
              case when v_durum = 'stokta' then 'bekliyor' else v_durum end,
              case when v_durum = 'stokta' then 'toplam' else v_sebep end,
              v_aday, v_mal, case when v_mal is not null then v_carpan end, v_stok,
              v_cozen, case when v_cozen is not null then now() end, v_gelen, v_sayim, v_teslimat, v_okunan, v_not);
    if v_sayim is not null or v_teslimat is not null then
      v_kalemler := v_kalemler || jsonb_build_object('sira', v_sira, 'metin', left(v_metin, 120), 'faturadaki', v_miktar,
        'gelen', v_gelen, 'sayim', v_sayim, 'teslimat', v_teslimat, 'okunan', v_okunan, 'not', v_not);
    end if;
  end loop;

  -- Toplam kontrolü: (a) tüm satırların KDV dahil tutarı belli ve genel toplamı tutuyor, ya da (b) KDV belirsiz ama
  -- tüm satırların KDV hariç tutarı belli ve faturadaki hariç toplamı tutuyor (tutarlar doğru okundu, oran bilinmiyor).
  v_pay := greatest(1, 0.01 * v_sira);
  v_tutuyor := (not v_dahil_eksik and abs(round(v_sum, 2) - v_ind - v_genel) <= v_pay
                and (v_thar is null or v_haric_eksik or abs(v_sum_har - v_thar) <= v_pay))
            or (v_thar is not null and not v_haric_eksik and abs(v_sum_har - v_thar) <= v_pay);
  update belgeler set toplam_tutuyor = v_tutuyor where id = v_id;

  for v_satir in select id from belge_satirlari
                 where belge_id = v_id and durum = 'bekliyor' and bekleme_sebebi = 'toplam'
                   and (v_tutuyor or sayim = 'sayildi') order by sira loop
    -- Toplam tutmadıysa: sayılan mal stoğa girer, fiyatı doğrulanmadı sayılır.
    update belge_satirlari set durum = 'stokta', bekleme_sebebi = null,
                               fiyat_kontrol = fiyat_kontrol or not v_tutuyor
      where id = v_satir;
    perform belge_satiri_stokla(v_satir);
  end loop;

  perform belge_durumu_yenile(v_id);
  perform islem_yaz(v_mekan, 'mal_kabul', (select giris_id from belgeler where id = v_id), v_id,
    jsonb_build_object('tedarikci', v_ted, 'fatura_no', v_no, 'kaynak', v_kaynak, 'toplam_tutuyor', v_tutuyor,
                       'karekod', p -> 'okunan' -> 'karekod_kontrol', 'kalemler', v_kalemler));
  select count(*) filter (where durum = 'stokta'), count(*) filter (where durum = 'bekliyor'),
         count(*) filter (where durum = 'takip_disi')
    into v_say_stok, v_say_bekle, v_say_disi from belge_satirlari where belge_id = v_id;
  return jsonb_build_object('id', v_id, 'durum', (select durum from belgeler where id = v_id), 'tekrar', false,
    'toplam_tutuyor', v_tutuyor, 'stoklanan', v_say_stok, 'bekleyen', v_say_bekle, 'takip_disi', v_say_disi);
end $$;

-- ---------- 4) Kurulum: satırı bağlama, KDV sorulmadan ----------
-- kurulum_satir_coz'un malzeme kolu; tek fark: tutar KDV dahil ve isteğe bağlı. Tutar yazılmazsa ve satırın KDV dahil
-- tutarı bilinmiyorsa satır yine stoğa girer, fiyatı kontrol bekler. Eski kurulum_satir_coz (takip dışı için) kalır.
create or replace function public.kurulum_satir_bagla(p_satir bigint, p_malzeme uuid, p_carpan numeric, p_miktar numeric,
                                                      p_tutar_dahil numeric, p_deftere_yaz boolean,
                                                      p_onay boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  s belge_satirlari;
  b belgeler;
  m malzemeler;
  v_stok numeric;
  v_fstok numeric;
  v_dahil numeric;
  v_sebep text;
  v_fiyat_birimi text;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  select * into s from belge_satirlari where id = p_satir for update;
  if not found or s.durum <> 'bekliyor' then raise exception 'Satır bulunamadı ya da zaten çözülmüş.'; end if;
  select * into b from belgeler where id = s.belge_id;
  if b.iptal_zamani is not null then raise exception 'Bu belge iptal edilmiş.'; end if;
  select * into m from malzemeler where id = p_malzeme and mekan_id = s.mekan_id;
  if not found then raise exception 'Malzeme bu mekana ait değil.'; end if;
  if p_carpan is null or p_carpan <= 0 or p_carpan > 1000000 then raise exception 'Çarpanı yaz (1 belge birimi = kaç g/ml/adet).'; end if;
  s.miktar := coalesce(p_miktar, s.miktar);
  if s.miktar is null or s.miktar <= 0 then raise exception 'Miktarı yaz.'; end if;
  if p_tutar_dahil is not null and (p_tutar_dahil < 0 or p_tutar_dahil >= 1000000000) then raise exception 'Tutar geçersiz.'; end if;
  if p_tutar_dahil is not null then s.tutar_dahil := round(p_tutar_dahil, 2); end if;
  v_dahil := satir_dahil_tutar(s.tutar_dahil, s.tutar_haric, s.kdv_orani);
  v_fstok := round(s.miktar * p_carpan, 3);
  v_stok := round(coalesce(s.gelen_miktar, s.miktar) * p_carpan, 3);
  v_sebep := satir_olagandisi(s.mekan_id, p_malzeme, v_fstok, v_dahil, case when v_dahil is not null then 0 end);
  if v_sebep is not null and not coalesce(p_onay, false) then
    v_fiyat_birimi := case m.birim when 'g' then 'kg' when 'ml' then 'litre' else 'adet' end;
    if v_sebep = 'fiyat' then
      raise exception 'Fiyat tutmuyor: bu bağlamayla % için % ₺/% çıkıyor, kayıtlı fiyat % ₺/%. Çarpanı ve miktarı kontrol et (ör. 1 şişe = 200 ml). Doğruysa "Fiyat/miktar doğru" kutusunu işaretleyip tekrar bağla.',
        m.ad, translate(to_char(round(v_dahil / v_fstok * (case m.birim when 'adet' then 1 else 1000 end), 2), 'FM999G999G990D00'), ',.', '.,'),
        v_fiyat_birimi, translate(to_char(m.fiyat, 'FM999G999G990D00'), ',.', '.,'), v_fiyat_birimi;
    else
      raise exception 'Miktar olağandışı: % için % % stoğa girecek, önceki faturaların 3 katından fazla ya da üçte birinden az. Çarpanı ve miktarı kontrol et. Doğruysa "Fiyat/miktar doğru" kutusunu işaretleyip tekrar bağla.',
        m.ad, rtrim(rtrim(translate(to_char(v_fstok, 'FM999G999G990D000'), ',.', '.,'), '0'), ','), m.birim;
    end if;
  end if;
  update belge_satirlari
    set durum = 'stokta', bekleme_sebebi = null, malzeme_id = p_malzeme, carpan = p_carpan,
        miktar = round(s.miktar, 3), tutar_dahil = s.tutar_dahil,
        fiyat_kontrol = (v_dahil is null), stok_miktari = v_stok, cozen = 'kurulum', cozum_zamani = now()
    where id = p_satir;
  if p_deftere_yaz then
    insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, kaynak)
      values (s.mekan_id, b.tedarikci_anahtar, s.metin_anahtar, coalesce(s.birim, 'diger'), 'malzeme', p_malzeme, p_carpan, 'kurulum')
      on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
        set sonuc = 'malzeme', malzeme_id = excluded.malzeme_id, carpan = excluded.carpan,
            kaynak = 'kurulum', guncelleme = now();
  end if;
  perform belge_satiri_stokla(p_satir);
  perform belge_durumu_yenile(s.belge_id);
end $$;

-- Kurulum kuyruğu: 12'deki işlevin aynısı; satırlara KDV dahil tutar eklendi (form KDV sormaz).
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
              'tutar_dahil', satir_dahil_tutar(s.tutar_dahil, s.tutar_haric, s.kdv_orani),
              'durum', s.durum, 'sebep', s.bekleme_sebebi, 'aday_malzeme_id', s.aday_malzeme_id,
              'malzeme_id', s.malzeme_id, 'carpan', s.carpan) order by s.sira), '[]')
            from belge_satirlari s where s.belge_id = b.id)) order by b.olusturma)
        from belgeler b where b.mekan_id = k.id and b.durum = 'bekliyor' and b.iptal_zamani is null)))
    from mekanlar k
    where exists (select 1 from belgeler b where b.mekan_id = k.id and b.durum = 'bekliyor' and b.iptal_zamani is null)
  ), '[]'::jsonb);
end $$;

-- Kurulum: AI'nın ya da eşleşmemenin "takip dışı" saydığı son satırlar (yanlışsa geri alınır). 06'daki işlevin aynısı,
-- eşleşmeyen satırlar da listelenir.
create or replace function public.kurulum_ai_takip_disi() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'mekan', k.ad, 'metin', s.metin, 'miktar', s.miktar, 'birim', s.birim,
                                        'tarih', b.olusturma, 'tedarikci', b.tedarikci, 'neden', s.cozen) order by b.olusturma desc)
    from (select * from belge_satirlari where cozen in ('ai', 'eslesmedi') and durum = 'takip_disi' order by id desc limit 100) s
    join belgeler b on b.id = s.belge_id and b.iptal_zamani is null
    join mekanlar k on k.id = s.mekan_id), '[]'::jsonb);
end $$;

-- ---------- 5) Fiyatı kontrol bekleyen kalemler (patron) ----------
-- Açık (iptal edilmemiş girişte, 'fiyat_kontrol') kalemler. onayli_fiyat: malzemenin son onaylı fiyatı (yoksa 0):
-- raporda TL bu fiyatla "tahmini" hesaplanır; hiç yoksa kalem TL toplamına girmez.
create or replace function public.fiyat_kontrolleri() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mekan uuid := benim_mekanim();
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Fiyat bilgisi yalnız patrona açık.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', gk.id, 'malzeme_id', m.id, 'malzeme', m.ad, 'birim', m.birim, 'miktar', gk.miktar, 'tutar', gk.tutar,
      'tarih', g.tarih, 'tedarikci', g.aciklama, 'giren_ad', g.giren_ad, 'onayli_fiyat', m.fiyat,
      'faturadaki', case when s.miktar > 0 and s.carpan > 0 then round(s.miktar * s.carpan, 3) end,
      'satir_metni', gk.satir_metni, 'belge_id', b.id, 'toplam_tutuyor', b.toplam_tutuyor,
      'dosyalar', (select coalesce(jsonb_agg(jsonb_build_object('yol', d.yol, 'tur', d.tur) order by d.id), '[]'::jsonb)
                   from belge_dosyalari d where d.belge_id = b.id)) order by g.tarih desc, gk.id desc)
    from giris_kalemleri gk
      join girisler g on g.id = gk.giris_id
      join malzemeler m on m.id = gk.malzeme_id
      left join belge_satirlari s on s.id = gk.belge_satir_id
      left join belgeler b on b.id = s.belge_id
    where g.mekan_id = v_mekan and gk.mekan_id = v_mekan and g.iptal_zamani is null
      and 'fiyat_kontrol' = any(gk.uyarilar)), '[]'::jsonb);
end $$;

-- Patron kontrol bekleyen fiyatı kapatır.
--   p_tutar: faturada bu satırın yazdığı tutar (KDV dahil, faturadaki miktarın tamamı için). Fiyat buradan hesaplanır.
--   p_tutar null: "kayıtlı fiyat doğru" — malzemenin son onaylı fiyatı kalır (onaylı fiyat yoksa olmaz).
create or replace function public.fiyat_kontrol_coz(p_kalem bigint, p_tutar numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  gk giris_kalemleri;
  g girisler;
  m malzemeler;
  s belge_satirlari;
  v_fstok numeric;
  v_fiyat numeric;
  v_ad text;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Fiyatı yalnız patron onaylayabilir.'; end if;
  select * into gk from giris_kalemleri where id = p_kalem and mekan_id = v_mekan and 'fiyat_kontrol' = any(uyarilar) for update;
  if not found then raise exception 'Kayıt bulunamadı ya da zaten onaylanmış.'; end if;
  select * into g from girisler where id = gk.giris_id;
  if g.iptal_zamani is not null then raise exception 'Bu giriş iptal edilmiş.'; end if;
  select * into m from malzemeler where id = gk.malzeme_id;
  if gk.belge_satir_id is not null then select * into s from belge_satirlari where id = gk.belge_satir_id for update; end if;
  v_fstok := case when s.miktar > 0 and s.carpan > 0 then round(s.miktar * s.carpan, 3) else gk.miktar end;
  v_ad := coalesce((select ad from uyeler where user_id = auth.uid()), '?');

  if p_tutar is null then
    if not coalesce(m.fiyat, 0) > 0 then raise exception 'Bu malzemenin onaylı fiyatı yok. Faturadaki tutarı yaz.'; end if;
  else
    if p_tutar <= 0 or p_tutar >= 1000000000 then raise exception 'Tutar geçersiz.'; end if;
    if not v_fstok > 0 then raise exception 'Miktar bilinmediği için fiyat hesaplanamıyor.'; end if;
    v_fiyat := round(p_tutar / v_fstok * (case m.birim when 'adet' then 1 else 1000 end), 2);
    if v_fiyat >= 10000000 then raise exception 'Tutar geçersiz.'; end if;
    insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id, degistiren, degistiren_ad)
      values (v_mekan, m.id, v_fiyat, null, null, g.tarih, 'fatura', g.id, auth.uid(), v_ad);
    update giris_kalemleri set tutar = round(p_tutar * gk.miktar / v_fstok, 2) where id = gk.id;
    if s.id is not null then
      update belge_satirlari set tutar_dahil = round(p_tutar, 2), fiyat_kontrol = false where id = s.id;
      update teslimat_farklari set fark_tl = round(p_tutar / v_fstok * (faturadaki - gelen), 2)
        where belge_satir_id = s.id and durum = 'acik';
    end if;
    perform fiyat_yenile(m.id);
  end if;
  update giris_kalemleri set uyarilar = array_append(array_remove(uyarilar, 'fiyat_kontrol'), 'fiyat_onaylandi')
    where id = gk.id;
  if s.id is not null and p_tutar is null then update belge_satirlari set fiyat_kontrol = false where id = s.id; end if;
  perform islem_yaz(v_mekan, 'fiyat_onay', g.id, s.belge_id,
    jsonb_build_object('malzeme', m.ad, 'tutar', p_tutar, 'birim_fiyat', v_fiyat, 'kayitli_fiyat_kaldi', p_tutar is null));
end $$;

-- ---------- 6) Elle mal girişi: oran uydurulmaz ----------
-- 22'deki işlevin aynısı; değişen: fişteki tutar KDV dahil saklanır, KDV oranı/hariç tutar boş kalır (eskiden
-- malzemenin oranı ya da %0 varsayılıyordu).
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
    v_uyari := null;
    -- Kayıtlı fiyattan %30'dan fazla sapan tutar fiyatı değiştirmez; patron kontrol eder. (Tutar KDV dahil: oran 0 verilir.)
    if v_tutar > 0 and satir_olagandisi(v_mekan, m.id, v_miktar, v_tutar, 0) = 'fiyat' then
      v_uyari := array['fiyat_kontrol'];
    end if;
    insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani, satir_metni, uyarilar)
      values (v_id, v_mekan, m.id, v_miktar, v_tutar, null, null, 'Elle giriş', v_uyari);
    insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
      values (v_id, v_mekan, m.id, v_miktar)
      on conflict (giris_id, malzeme_id) do update set miktar = malzeme_hareketleri.miktar + excluded.miktar;
    if v_tutar > 0 and v_uyari is null then
      v_birim_fiyat := round(v_tutar / v_miktar * (case m.birim when 'adet' then 1 else 1000 end), 2);
      if v_birim_fiyat < 10000000 then
        insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id, degistiren, degistiren_ad)
          values (v_mekan, m.id, v_birim_fiyat, null, null, bugun(), 'fatura', v_id, auth.uid(), coalesce(v_ad, '?'));
        perform fiyat_yenile(m.id);
      end if;
    end if;
  end loop;

  insert into giris_istekleri (mekan_id, istek_id, giris_id) values (v_mekan, p_istek, v_id);
  return v_id;
end $$;

-- ---------- 7) Fiyat değişimleri: ortalama yalnız doğrulanmış fiyatlarla ----------
-- 22'deki işlevin aynısı; değişen: fiyatı kontrol bekleyen kalemler 90 günlük ortalamaya girmez.
create or replace function public.fiyat_degisimleri() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_bugun date := bugun();
  v_satis_var boolean;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Fiyat bilgisi yalnız patrona açık.'; end if;
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
        and not ('fiyat_kontrol' = any(coalesce(gk.uyarilar, '{}')))
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

-- ---------- 8) Günlük kontrol: fiyatı doğrulanmayan kalem sayısı ----------
-- 22'deki işlevin aynısı + 'fiyat_kontrol' (açık kalem sayısı) ve 'fiyatsiz_kontrol' (onaylı fiyatı hiç olmayanlar).
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
    'elle_fiyat_kontrol', coalesce((select jsonb_agg(jsonb_build_object('malzeme', m.ad, 'miktar', gk.miktar, 'birim', m.birim,
                                       'tutar', gk.tutar, 'giren_ad', g.giren_ad, 'tarih', g.tarih) order by g.tarih desc)
                            from giris_kalemleri gk join girisler g on g.id = gk.giris_id join malzemeler m on m.id = gk.malzeme_id
                            where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tarih > v_bugun - 7
                              and 'fiyat_kontrol' = any(gk.uyarilar)), '[]'::jsonb),
    'fiyat_kontrol', (select count(*) from giris_kalemleri gk join girisler g on g.id = gk.giris_id
                      where g.mekan_id = v_mekan and g.iptal_zamani is null and 'fiyat_kontrol' = any(gk.uyarilar)),
    'elle_giris_7gun', (select count(*) from girisler where mekan_id = v_mekan and tur = 'fatura' and iptal_zamani is null
                          and tarih > v_bugun - 7 and aciklama like 'Elle giriş%'));
end $$;

-- ---------- Yetkiler ----------
revoke all on function public.satir_dahil_tutar(numeric, numeric, numeric),
  public.kurulum_satir_bagla(bigint, uuid, numeric, numeric, numeric, boolean, boolean),
  public.fiyat_kontrolleri(), public.fiyat_kontrol_coz(bigint, numeric)
  from public, anon, authenticated;
grant execute on function public.kurulum_satir_bagla(bigint, uuid, numeric, numeric, numeric, boolean, boolean),
  public.fiyat_kontrolleri(), public.fiyat_kontrol_coz(bigint, numeric) to authenticated;
-- Yenilenen işlevler (create or replace) eski yetkilerini korur; yine de açıkça:
revoke all on function public.belge_satiri_stokla(bigint) from public, anon, authenticated;
grant execute on function public.belge_kaydet(jsonb), public.kurulum_kuyrugu(), public.kurulum_ai_takip_disi(),
  public.elle_mal_kabul(uuid, text, jsonb), public.fiyat_degisimleri(), public.gunluk_kontrol() to authenticated;
revoke all on function public.belge_kaydet(jsonb), public.kurulum_kuyrugu(), public.kurulum_ai_takip_disi(),
  public.elle_mal_kabul(uuid, text, jsonb), public.fiyat_degisimleri(), public.gunluk_kontrol() from anon;
