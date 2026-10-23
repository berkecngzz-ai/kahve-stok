-- 21: Mal kabul — kör sayım, teslimat farkı, işlem geçmişi, karekodla mükerrer kontrolü (2026-10-24).
-- 20_patron_ekranlari.sql'den SONRA çalıştırılır. Mevcut veriyi DEĞİŞTİRMEZ (yalnız yeni sütun/tablo/işlev).
--
-- Kural: faturada 24 L süt yazar, barista faturayı görmeden 22 L sayar → stok 22 L artar, fiyat faturadan
-- (tutar / 24 L) hesaplanır, 2 L eksik teslimat patrona "kontrol bekliyor" görevi olarak düşer; görevi yalnız
-- patron kapatır. Her mal kabul, iptal ve fark kararı işlem geçmişine yazılır; geçmiş değiştirilemez.
--
-- Geri dönüş: scripts/geri-al-21.sql

-- ---------- 1) Belge satırı: sayılan miktar ----------
-- gelen_miktar : baristanın saydığı (belge birimiyle, miktar gibi). null = sayılmadı (eski kayıt / kurulum satırı).
-- sayim        : sayildi | sayilmadi (dökme/tartılı: barista sayamadı, faturadaki kabul edildi)
-- teslimat     : tam | okuma_hatasi | teslimat_farki | belirsiz (telefonun kararı; fark kaydını sunucu açar)
-- okunan_miktar: okuma hatası düzeltildiyse ilk okumadaki miktar (iz için)
alter table public.belge_satirlari
  add column gelen_miktar  numeric(16,3) check (gelen_miktar >= 0),
  add column sayim         text check (sayim in ('sayildi', 'sayilmadi')),
  add column teslimat      text check (teslimat in ('tam', 'okuma_hatasi', 'teslimat_farki', 'belirsiz')),
  add column okunan_miktar numeric(16,3) check (okunan_miktar >= 0),
  add column barista_notu  text check (length(barista_notu) <= 300);
-- Hiç gelmeyen kalem (faturada var, sayım 0) de kaydedilebilsin: stok 0 artar, fark tamamı.
alter table public.belge_satirlari drop constraint belge_satirlari_stok_miktari_check;
alter table public.belge_satirlari add constraint belge_satirlari_stok_miktari_check check (stok_miktari >= 0);

-- ---------- 2) İşlem geçmişi (yalnız eklenir) ----------
create table public.islem_gecmisi (
  id            bigint generated always as identity primary key,
  mekan_id      uuid not null references public.mekanlar(id) on delete cascade,
  zaman         timestamptz not null default now(),
  kullanici     uuid,
  kullanici_ad  text,
  tur           text not null check (tur in ('giris', 'giris_iptal', 'belge_iptal', 'mal_kabul', 'teslimat_farki',
                                             'fark_cozuldu')),
  giris_id      uuid,
  belge_id      uuid,
  ayrinti       jsonb check (ayrinti is null or pg_column_size(ayrinti) < 100000)
);
create index islem_gecmisi_mekan_idx on public.islem_gecmisi(mekan_id, zaman desc);

create or replace function public.islem_gecmisi_degismez() returns trigger
language plpgsql as $$
begin raise exception 'İşlem geçmişi değiştirilemez.'; end $$;
create trigger islem_gecmisi_degismez before update on public.islem_gecmisi
  for each row execute function public.islem_gecmisi_degismez();

create or replace function public.islem_yaz(p_mekan uuid, p_tur text, p_giris uuid, p_belge uuid, p_ayrinti jsonb)
returns void language sql security definer set search_path = public as $$
  insert into islem_gecmisi (mekan_id, kullanici, kullanici_ad, tur, giris_id, belge_id, ayrinti)
  values (p_mekan, auth.uid(), (select ad from uyeler where user_id = auth.uid()), p_tur, p_giris, p_belge, p_ayrinti)
$$;

-- ---------- 3) Teslimat farkları (patron görevi) ----------
-- Miktarlar malzemenin stok birimiyle (g / ml / adet). fark_tl > 0 eksik, < 0 fazla teslimat (KDV dahil).
create table public.teslimat_farklari (
  id              uuid primary key default gen_random_uuid(),
  mekan_id        uuid not null references public.mekanlar(id) on delete cascade,
  belge_id        uuid not null,
  belge_satir_id  bigint not null unique references public.belge_satirlari(id),
  malzeme_id      uuid not null,
  faturadaki      numeric(16,3) not null check (faturadaki >= 0),
  gelen           numeric(16,3) not null check (gelen >= 0),
  fark_tl         numeric(14,2),
  okuma_supheli   boolean not null default false,
  barista_notu    text check (length(barista_notu) <= 300),
  durum           text not null default 'acik' check (durum in ('acik', 'cozuldu', 'iptal')),
  cozum           text check (cozum in ('iade', 'sonra_geldi', 'indirim', 'fark_yok', 'diger')),
  cozum_notu      text check (length(cozum_notu) <= 300),
  cozen           uuid,
  cozen_ad        text,
  cozum_zamani    timestamptz,
  olusturma       timestamptz not null default now(),
  foreign key (belge_id, mekan_id) references public.belgeler(id, mekan_id),
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id),
  check (durum <> 'cozuldu' or (cozum is not null and cozum_zamani is not null))
);
create index teslimat_farklari_acik_idx on public.teslimat_farklari(mekan_id, olusturma desc) where durum = 'acik';

alter table public.islem_gecmisi     enable row level security;
alter table public.teslimat_farklari enable row level security;
create policy islem_gecmisi_gor on public.islem_gecmisi for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
create policy teslimat_farki_gor on public.teslimat_farklari for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
revoke all on public.islem_gecmisi, public.teslimat_farklari from anon, authenticated;
grant select on public.islem_gecmisi, public.teslimat_farklari to authenticated;

-- ---------- 4) Geçmişe otomatik yazım (girişler, iptaller, farklar) ----------
create or replace function public.giris_gecmise_yaz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform islem_yaz(new.mekan_id, 'giris', new.id, null,
      jsonb_build_object('tur', new.tur, 'tarih', new.tarih, 'aciklama', new.aciklama, 'giren_ad', new.giren_ad));
  elsif old.iptal_zamani is null and new.iptal_zamani is not null then
    perform islem_yaz(new.mekan_id, 'giris_iptal', new.id, null,
      jsonb_build_object('tur', new.tur, 'tarih', new.tarih, 'iptal_eden_ad', new.iptal_eden_ad));
  end if;
  return null;
end $$;
create trigger girisler_gecmis after insert or update of iptal_zamani on public.girisler
  for each row execute function public.giris_gecmise_yaz();

-- Belge iptal edilince (barista 2 dk geri alma / patron girişi iptal) açık farkları da kapanır.
create or replace function public.belge_iptal_gecmise_yaz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.iptal_zamani is null and new.iptal_zamani is not null then
    update teslimat_farklari set durum = 'iptal' where belge_id = new.id and durum = 'acik';
    perform islem_yaz(new.mekan_id, 'belge_iptal', new.giris_id, new.id,
      jsonb_build_object('tedarikci', new.tedarikci, 'fatura_no', new.fatura_no, 'iptal_eden_ad', new.iptal_eden_ad));
  end if;
  return null;
end $$;
create trigger belgeler_iptal_gecmis after update of iptal_zamani on public.belgeler
  for each row execute function public.belge_iptal_gecmise_yaz();

create or replace function public.fark_gecmise_yaz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform islem_yaz(new.mekan_id, 'teslimat_farki', null, new.belge_id,
    jsonb_build_object('malzeme_id', new.malzeme_id, 'malzeme', (select ad from malzemeler where id = new.malzeme_id),
                       'faturadaki', new.faturadaki, 'gelen', new.gelen, 'fark_tl', new.fark_tl,
                       'okuma_supheli', new.okuma_supheli, 'barista_notu', new.barista_notu));
  return null;
end $$;
create trigger teslimat_farklari_gecmis after insert on public.teslimat_farklari
  for each row execute function public.fark_gecmise_yaz();

-- ---------- 5) Mükerrer kontrolü (okumadan ÖNCE, karekoddan) ----------
-- Barista belgeler tablosunu göremez; bu işlev yalnız "bu mekanda bu fatura etkin olarak var mı" der.
create or replace function public.belge_kayitli_mi(p_ettn text, p_no text, p_vkn text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_ettn text := nullif(lower(trim(p_ettn)), '');
  v_no   text := nullif(upper(trim(p_no)), '');
  v_vkn  text := nullif(regexp_replace(coalesce(p_vkn, ''), '\D', '', 'g'), '');
  b belgeler;
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  select * into b from belgeler
    where mekan_id = v_mekan and iptal_zamani is null
      and ((v_ettn is not null and lower(ettn) = v_ettn)
        or (v_no is not null and v_vkn is not null and tedarikci_anahtar = v_vkn and fatura_no = v_no))
    order by olusturma limit 1;
  if not found then return jsonb_build_object('var', false); end if;
  return jsonb_build_object('var', true, 'giren_ad', b.giren_ad,
    'tarih', to_char(b.olusturma at time zone 'Europe/Istanbul', 'DD.MM.YYYY'));
end $$;

-- ---------- 6) Stoğa ekleme: sayılan miktar + fatura fiyatı + fark kaydı ----------
-- Stok SAYILAN kadar artar. Birim fiyat FATURADAKİ miktardan hesaplanır (eksik gelen mal fiyatı şişirmez).
-- Giriş kalemi tutarı alınan malın değeridir (tutar × gelen / faturadaki); faturanın tamamı belgede durur.
create or replace function public.belge_satiri_stokla(p_satir bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  s belge_satirlari;
  b belgeler;
  v_birim text;
  v_haric numeric;
  v_fstok numeric;    -- faturadaki miktar, stok biriminde
  v_oran  numeric;    -- gelen / faturadaki
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

  insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani, satir_metni)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari,
            case when s.tutar_haric is not null and s.kdv_orani is not null
                 then round(s.tutar_haric * v_oran * (1 + s.kdv_orani / 100), 2) end,
            round(s.tutar_haric * v_oran, 2), s.kdv_orani, left(s.metin, 200));
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari)
    on conflict (giris_id, malzeme_id) do update set miktar = malzeme_hareketleri.miktar + excluded.miktar;

  if s.tutar_haric > 0 and s.kdv_orani is not null and v_fstok > 0 then
    select birim into v_birim from malzemeler where id = s.malzeme_id;
    v_haric := round(s.tutar_haric / v_fstok * (case v_birim when 'adet' then 1 else 1000 end), 4);
    if v_haric < 10000000 then
      insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id,
                                 degistiren, degistiren_ad)
        select b.mekan_id, s.malzeme_id, round(v_haric * (1 + s.kdv_orani / 100), 2), v_haric, s.kdv_orani,
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
              case when s.tutar_haric is not null and s.kdv_orani is not null
                   then round(s.tutar_haric * (1 + s.kdv_orani / 100) / v_fstok * (v_fstok - s.stok_miktari), 2) end,
              coalesce(s.teslimat, '') = 'belirsiz', s.barista_notu)
      on conflict (belge_satir_id) do nothing;
  end if;
end $$;

-- ---------- 7) Patronun açık görevleri: malzeme, tedarikçi, faturanın dosyaları ----------
create or replace function public.teslimat_gorevleri() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not patron_muyum() then raise exception 'Bu bilgi yalnız patrona açık.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.olusturma desc) from (
    select f.id, f.olusturma, f.faturadaki, f.gelen, f.fark_tl, f.okuma_supheli, f.barista_notu,
           m.ad as malzeme, m.birim, b.tedarikci, b.belge_tarihi, b.fatura_no, b.giren_ad, s.metin as satir_metni,
           (select coalesce(jsonb_agg(jsonb_build_object('yol', d.yol, 'tur', d.tur) order by d.id), '[]'::jsonb)
              from belge_dosyalari d where d.belge_id = b.id) as dosyalar
    from teslimat_farklari f
      join malzemeler m on m.id = f.malzeme_id
      join belgeler b on b.id = f.belge_id
      join belge_satirlari s on s.id = f.belge_satir_id
    where f.mekan_id = benim_mekanim() and f.durum = 'acik') x), '[]'::jsonb);
end $$;

-- ---------- 7b) Fark görevini kapatma (yalnız patron) ----------
create or replace function public.teslimat_farki_coz(p_id uuid, p_cozum text, p_not text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  f teslimat_farklari;
  v_ad text;
begin
  if not patron_muyum() then raise exception 'Teslimat farkını yalnız patron kapatabilir.'; end if;
  if p_cozum is null or p_cozum not in ('iade', 'sonra_geldi', 'indirim', 'fark_yok', 'diger') then
    raise exception 'Geçersiz seçim.';
  end if;
  if p_cozum = 'diger' and nullif(trim(p_not), '') is null then raise exception 'Kısa bir açıklama yaz.'; end if;
  select * into f from teslimat_farklari where id = p_id and mekan_id = benim_mekanim() for update;
  if not found then raise exception 'Kayıt bulunamadı.'; end if;
  if f.durum <> 'acik' then raise exception 'Bu fark zaten kapatılmış.'; end if;
  v_ad := coalesce((select ad from uyeler where user_id = auth.uid()), '?');
  update teslimat_farklari set durum = 'cozuldu', cozum = p_cozum, cozum_notu = left(nullif(trim(p_not), ''), 300),
                               cozen = auth.uid(), cozen_ad = v_ad, cozum_zamani = now()
    where id = p_id;
  perform islem_yaz(f.mekan_id, 'fark_cozuldu', null, f.belge_id,
    jsonb_build_object('fark_id', f.id, 'malzeme', (select ad from malzemeler where id = f.malzeme_id),
                       'cozum', p_cozum, 'not', left(nullif(trim(p_not), ''), 300), 'fark_tl', f.fark_tl));
end $$;

-- ---------- 8) Belge kaydetme: sayılan miktar ----------
-- 06'daki işlevin aynısı; değişenler: satırdaki gelen_miktar / sayim / teslimat / okunan_miktar / barista_notu
-- alınır, stok sayılan kadar, fiyat-miktar kontrolü faturadaki miktarla, mal kabul işlem geçmişine yazılır.
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
  v_sum     numeric := 0;
  v_pay     numeric;
  v_tutuyor boolean;
  v_onceki  belgeler;
  k         jsonb;
  v_sira    int := 0;
  v_metin   text; v_manah text; v_miktar numeric; v_birim text; v_bfiyat numeric; v_haric numeric; v_oran numeric;
  v_sinif   text; v_mal uuid; v_carpan numeric; v_aday uuid; v_onay boolean;
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
    v_sinif := k ->> 'sinif';
    v_mal := null; v_aday := null; v_carpan := null;
    begin v_mal := (k ->> 'malzeme_id')::uuid; exception when others then v_mal := null; end;
    begin v_aday := (k ->> 'aday_malzeme_id')::uuid; exception when others then v_aday := null; end;
    if v_mal is not null and not exists (select 1 from malzemeler where id = v_mal and mekan_id = v_mekan) then v_mal := null; end if;
    if v_aday is not null and not exists (select 1 from malzemeler where id = v_aday and mekan_id = v_mekan) then v_aday := null; end if;
    v_carpan := case when jsonb_typeof(k -> 'carpan') = 'number' and (k ->> 'carpan')::numeric between 0.000001 and 1000000
                     then (k ->> 'carpan')::numeric end;
    v_onay := coalesce(case when jsonb_typeof(k -> 'barista_onayi') = 'boolean' then (k ->> 'barista_onayi')::boolean end, false);
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
    v_sum := v_sum + coalesce(v_haric * (1 + coalesce(v_oran, 0) / 100), 0);

    v_durum := 'bekliyor'; v_sebep := 'eslesme'; v_cozen := null; v_stok := null;
    if v_sinif = 'takip_disi' and exists (
         select 1 from eslestirme_defteri
         where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and sonuc = 'takip_disi'
           and tedarikci_anahtar in (v_tedanah, '')) then
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'otomatik'; v_mal := null;
    elsif v_sinif = 'takip_disi' and v_ai is not null and ai_takip_disi_mi(v_ai, v_mekan, v_sira, v_manah) then
      -- AI (sunucudaki kaydına göre) bu satır için emin olarak "takip dışı" demiş
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'ai'; v_mal := null;
    elsif v_sinif = 'takip_disi' then
      v_aday := null; v_mal := null;
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
        insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, kaynak)
          values (v_mekan, v_tedanah, v_manah, v_birim, 'malzeme', v_mal, v_carpan, 'barista')
          on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
            set sonuc = 'malzeme', malzeme_id = excluded.malzeme_id, carpan = excluded.carpan,
                kaynak = 'barista', guncelleme = now()
            where eslestirme_defteri.kaynak <> 'kurulum';
      end if;
      if v_cozen is not null then
        if v_miktar is null or v_miktar = 0 then
          v_sebep := 'eksik';
        else
          v_fstok := round(v_miktar * v_carpan, 3);
          v_stok := round(coalesce(v_gelen, v_miktar) * v_carpan, 3);     -- stok SAYILAN kadar
          if v_haric is null or v_oran is null then
            v_sebep := 'eksik';
          elsif v_bfiyat is not null and abs(v_miktar * v_bfiyat - v_haric) > greatest(1, v_haric * 0.01) then
            v_sebep := 'tutar';
          else
            v_sebep := satir_olagandisi(v_mekan, v_mal, v_fstok, v_haric, v_oran);
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
                                 kdv_orani, durum, bekleme_sebebi, aday_malzeme_id, malzeme_id, carpan, stok_miktari,
                                 cozen, cozum_zamani, gelen_miktar, sayim, teslimat, okunan_miktar, barista_notu)
      values (v_id, v_mekan, v_sira, v_metin, v_manah, v_miktar, v_birim, v_bfiyat, v_haric, v_oran,
              case when v_durum = 'stokta' then 'bekliyor' else v_durum end,
              case when v_durum = 'stokta' then 'toplam' else v_sebep end,
              v_aday, v_mal, case when v_mal is not null then v_carpan end, v_stok,
              v_cozen, case when v_cozen is not null then now() end, v_gelen, v_sayim, v_teslimat, v_okunan, v_not);
    if v_sayim is not null or v_teslimat is not null then
      v_kalemler := v_kalemler || jsonb_build_object('sira', v_sira, 'metin', left(v_metin, 120), 'faturadaki', v_miktar,
        'gelen', v_gelen, 'sayim', v_sayim, 'teslimat', v_teslimat, 'okunan', v_okunan, 'not', v_not);
    end if;
  end loop;

  v_pay := greatest(1, 0.01 * v_sira);
  v_tutuyor := abs(round(v_sum, 2) - v_ind - v_genel) <= v_pay
               and (v_thar is null or abs((select coalesce(sum(tutar_haric), 0) from belge_satirlari where belge_id = v_id) - v_thar) <= v_pay)
               and not exists (select 1 from belge_satirlari where belge_id = v_id and tutar_haric is null);
  update belgeler set toplam_tutuyor = v_tutuyor where id = v_id;

  if v_tutuyor then
    for v_satir in select id from belge_satirlari
                   where belge_id = v_id and durum = 'bekliyor' and bekleme_sebebi = 'toplam' order by sira loop
      update belge_satirlari set durum = 'stokta', bekleme_sebebi = null where id = v_satir;
      perform belge_satiri_stokla(v_satir);
    end loop;
  end if;

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

-- ---------- 9) Kurulum satırı çözme: sayılan miktar korunur ----------
-- 12'deki işlevin aynısı; değişen: barista saydıysa stok sayılan kadar, kontroller faturadaki miktarla.
create or replace function public.kurulum_satir_coz(p_satir bigint, p_sonuc text, p_malzeme uuid, p_carpan numeric,
                                                    p_miktar numeric, p_tutar_haric numeric, p_kdv_orani numeric,
                                                    p_deftere_yaz boolean, p_onay boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  s belge_satirlari;
  b belgeler;
  m malzemeler;
  v_stok numeric;
  v_fstok numeric;     -- faturadaki miktar (stok birimi): fiyat/miktar kontrolü bununla
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
    v_fstok := round(s.miktar * p_carpan, 3);
    v_stok := round(coalesce(s.gelen_miktar, s.miktar) * p_carpan, 3);   -- barista saydıysa stok sayılan kadar
    -- Baristanın yolundaki kontrolün aynısı: bilinen fiyattan %30 sapma ya da geçmişin 3 katı miktar.
    -- Kurulum onaylarsa (gerçekten zam/indirim, büyük sipariş) geçer.
    v_sebep := satir_olagandisi(s.mekan_id, p_malzeme, v_fstok, s.tutar_haric, s.kdv_orani);
    if v_sebep is not null and not coalesce(p_onay, false) then
      v_fiyat_birimi := case m.birim when 'g' then 'kg' when 'ml' then 'litre' else 'adet' end;
      if v_sebep = 'fiyat' then
        v_birim_fiyat := s.tutar_haric * (1 + s.kdv_orani / 100) / v_fstok * (case m.birim when 'adet' then 1 else 1000 end);
        raise exception 'Fiyat tutmuyor: bu bağlamayla % için % ₺/% çıkıyor, kayıtlı fiyat % ₺/%. Çarpanı ve miktarı kontrol et (ör. 1 şişe = 200 ml). Doğruysa "Fiyat/miktar doğru" kutusunu işaretleyip tekrar bağla.',
          m.ad, translate(to_char(round(v_birim_fiyat, 2), 'FM999G999G990D00'), ',.', '.,'), v_fiyat_birimi,
          translate(to_char(m.fiyat, 'FM999G999G990D00'), ',.', '.,'), v_fiyat_birimi;
      else
        raise exception 'Miktar olağandışı: % için % % stoğa girecek, önceki faturaların 3 katından fazla ya da üçte birinden az. Çarpanı ve miktarı kontrol et. Doğruysa "Fiyat/miktar doğru" kutusunu işaretleyip tekrar bağla.',
          m.ad, rtrim(rtrim(translate(to_char(v_fstok, 'FM999G999G990D000'), ',.', '.,'), '0'), ','), m.birim;
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

-- ---------- 10) Yetkiler ----------
-- İç işlevler dışarıdan çağrılamaz; barista yalnız mükerrer kontrolünü, patron yalnız fark kapatmayı çağırır.
revoke all on function public.islem_yaz(uuid, text, uuid, uuid, jsonb), public.islem_gecmisi_degismez(),
  public.giris_gecmise_yaz(), public.belge_iptal_gecmise_yaz(), public.fark_gecmise_yaz(),
  public.belge_satiri_stokla(bigint), public.belge_kayitli_mi(text, text, text),
  public.teslimat_farki_coz(uuid, text, text), public.teslimat_gorevleri()
  from public, anon, authenticated;
grant execute on function public.belge_kayitli_mi(text, text, text), public.teslimat_farki_coz(uuid, text, text),
  public.teslimat_gorevleri() to authenticated;
