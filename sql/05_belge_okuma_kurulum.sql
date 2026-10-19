-- Adım 4 / Parça 2: Belge okuma kayıtları, eşleştirme defteri, kurulum kuyruğu, çift kayıt önleme,
-- baristaya fiyat gizliliği ve barista "geri al".
-- 04_fatura_belge_kdv.sql'den SONRA çalıştırılır.
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
--
-- İlke: emin olunamayan hiçbir satır sessizce stoğa girmez. Okunan belge olduğu gibi saklanır; eşleşmeyen satır
-- kurulum kuyruğunda açıkça bekler; patron "eksik var" bilgisini görür.

-- ---------- Yardımcılar ----------

-- Eşleştirme anahtarı: küçük harf, Türkçe harfler sadeleştirilmiş, işaretler boşluk, tek boşluk.
-- (Telefondaki eslestirme.js'deki anahtar() ile AYNI kural.)
create or replace function public.metin_anahtari(p text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(regexp_replace(
           translate(lower(translate(coalesce(p, ''), 'İIĞÜŞÖÇ', 'iığüşöç')), 'ığüşöçâîû', 'igusocaiu'),
           '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- ---------- Kurulum hesabı (servis sahibi) ----------
-- Tüm mekanların kurulum kuyruğunu görür ve çözer; mekanların başka verisine erişmez.
-- Yalnızca SQL ile eklenir (bkz. dosya sonu).
create table public.kurulum_hesaplari (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  olusturma  timestamptz not null default now()
);
alter table public.kurulum_hesaplari enable row level security;
revoke all on public.kurulum_hesaplari from anon, authenticated;

create or replace function public.kurulumcu_muyum() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kurulum_hesaplari where user_id = auth.uid())
$$;

-- ---------- Baristaya fiyat gizliliği ----------
-- Malzemelerin fiyat sütunları kimseye doğrudan okunmaz; patron fiyatları malzeme_fiyatlari() ile alır.
revoke select on public.malzemeler from authenticated;
grant select (id, mekan_id, ad, birim, aktif, olusturma) on public.malzemeler to authenticated;

create or replace function public.malzeme_fiyatlari()
returns table (id uuid, fiyat numeric, fiyat_haric numeric, kdv_orani numeric)
language sql stable security definer set search_path = public as $$
  select m.id, m.fiyat, m.fiyat_haric, m.kdv_orani from malzemeler m
  where m.mekan_id = benim_mekanim() and patron_muyum()
$$;

-- Fiyat geçmişi, girişler (tutarlar), giriş satırları, belgeleri ve stok hareketleri yalnızca patrona.
drop policy fiyat_gecmisi_gor on public.fiyat_gecmisi;
create policy fiyat_gecmisi_gor on public.fiyat_gecmisi for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
drop policy giris_gor on public.girisler;
create policy giris_gor on public.girisler for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
drop policy giris_kalemi_gor on public.giris_kalemleri;
create policy giris_kalemi_gor on public.giris_kalemleri for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
drop policy belge_gor on public.giris_belgeleri;
create policy belge_gor on public.giris_belgeleri for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
drop policy hareket_gor on public.malzeme_hareketleri;
create policy hareket_gor on public.malzeme_hareketleri for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());

-- ---------- Okunan belgeler ----------

create table public.belgeler (
  id                uuid primary key default gen_random_uuid(),
  mekan_id          uuid not null references public.mekanlar(id) on delete cascade,
  tur               text not null check (tur in ('fatura', 'satis_raporu')),
  kaynak            text not null check (kaynak in ('xml', 'pdf', 'ocr', 'elle', 'dosya')),
  istek_id          uuid not null,               -- telefonun ürettiği tek seferlik kimlik (tekrar denemede çift kayıt yok)
  dosya_ozeti       text check (dosya_ozeti ~ '^[0-9a-f]{64}$'),   -- ana dosyanın SHA-256 özeti
  ettn              text check (length(ettn) <= 64),
  fatura_no         text check (length(fatura_no) <= 64),
  tedarikci         text check (length(tedarikci) <= 200),
  tedarikci_vkn     text check (tedarikci_vkn ~ '^[0-9]{10,11}$'),
  tedarikci_anahtar text not null default '',
  belge_tarihi      date,
  genel_toplam      numeric(14,2) check (genel_toplam >= 0),
  kdv_haric_toplam  numeric(14,2) check (kdv_haric_toplam >= 0),
  kdv_toplam        numeric(14,2) check (kdv_toplam >= 0),
  indirim           numeric(14,2) check (indirim >= 0),
  toplam_tutuyor    boolean,
  okunan            jsonb,                        -- okuyucunun çıkardığı ham sonuç (iz için)
  durum             text not null check (durum in ('tamam', 'bekliyor')),
  giris_id          uuid,                         -- stoğa eklenen satırların girişi
  giren             uuid not null,
  giren_ad          text not null,
  olusturma         timestamptz not null default now(),
  iptal_eden        uuid,
  iptal_eden_ad     text,
  iptal_zamani      timestamptz,
  unique (id, mekan_id),
  unique (mekan_id, istek_id),
  foreign key (giris_id, mekan_id) references public.girisler(id, mekan_id),
  check (okunan is null or pg_column_size(okunan) < 300000)
);
-- Aynı belge iki kez etkin olamaz (iptal edilen yeniden yüklenebilir).
create unique index belgeler_ozet_uniq on public.belgeler(mekan_id, dosya_ozeti)
  where dosya_ozeti is not null and iptal_zamani is null;
create unique index belgeler_ettn_uniq on public.belgeler(mekan_id, ettn)
  where ettn is not null and iptal_zamani is null;
create unique index belgeler_no_uniq on public.belgeler(mekan_id, tedarikci_anahtar, fatura_no)
  where fatura_no is not null and tedarikci_anahtar <> '' and iptal_zamani is null;
create index belgeler_mekan_idx on public.belgeler(mekan_id, olusturma desc);
create index belgeler_bekleyen_idx on public.belgeler(durum) where durum = 'bekliyor' and iptal_zamani is null;

create table public.belge_dosyalari (
  id        bigint generated always as identity primary key,
  belge_id  uuid not null,
  mekan_id  uuid not null references public.mekanlar(id) on delete cascade,
  yol       text not null unique,
  tur       text not null check (tur in ('foto', 'pdf', 'xml', 'diger')),
  foreign key (belge_id, mekan_id) references public.belgeler(id, mekan_id)
);
create index belge_dosyalari_belge_idx on public.belge_dosyalari(belge_id);

-- Belgeden okunan her satır. durum: stokta / takip_disi / bekliyor (kurulum kuyruğunda).
create table public.belge_satirlari (
  id              bigint generated always as identity primary key,
  belge_id        uuid not null,
  mekan_id        uuid not null references public.mekanlar(id) on delete cascade,
  sira            int not null,
  metin           text not null check (length(metin) between 1 and 300),
  metin_anahtar   text not null,
  miktar          numeric(16,3) check (miktar >= 0),          -- belgedeki birimle
  birim           text check (birim in ('adet', 'kg', 'g', 'lt', 'ml', 'diger')),
  birim_fiyat     numeric(14,4) check (birim_fiyat >= 0),
  tutar_haric     numeric(14,2) check (tutar_haric >= 0),
  kdv_orani       numeric(5,2) check (kdv_orani between 0 and 100),
  durum           text not null check (durum in ('stokta', 'takip_disi', 'bekliyor')),
  bekleme_sebebi  text check (bekleme_sebebi in ('eslesme', 'donusum', 'toplam', 'tutar', 'fiyat', 'miktar', 'eksik')),
  aday_malzeme_id uuid,
  malzeme_id      uuid,
  carpan          numeric(16,6) check (carpan > 0),            -- 1 belge birimi = kaç g/ml/adet
  stok_miktari    numeric(16,3) check (stok_miktari > 0),
  cozen           text check (cozen in ('otomatik', 'barista', 'kurulum')),
  cozum_zamani    timestamptz,
  foreign key (belge_id, mekan_id) references public.belgeler(id, mekan_id),
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id),
  check (durum <> 'stokta' or (malzeme_id is not null and stok_miktari is not null)),
  check (durum <> 'bekliyor' or bekleme_sebebi is not null)
);
create index belge_satirlari_belge_idx on public.belge_satirlari(belge_id);
create index belge_satirlari_bekleyen_idx on public.belge_satirlari(mekan_id) where durum = 'bekliyor';

-- Eşleştirme defteri: (tedarikçi, satır metni, belge birimi) → malzeme + çarpan, ya da takip dışı.
-- tedarikci_anahtar = '' : tedarikçiden bağımsız kayıt.
create table public.eslestirme_defteri (
  id                bigint generated always as identity primary key,
  mekan_id          uuid not null references public.mekanlar(id) on delete cascade,
  tedarikci_anahtar text not null default '',
  metin_anahtar     text not null check (length(metin_anahtar) between 1 and 300),
  birim             text not null check (birim in ('adet', 'kg', 'g', 'lt', 'ml', 'diger')),
  sonuc             text not null check (sonuc in ('malzeme', 'takip_disi')),
  malzeme_id        uuid,
  carpan            numeric(16,6) check (carpan > 0),
  kaynak            text not null check (kaynak in ('barista', 'kurulum')),
  guncelleme        timestamptz not null default now(),
  unique (mekan_id, tedarikci_anahtar, metin_anahtar, birim),
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id),
  check (sonuc <> 'malzeme' or (malzeme_id is not null and carpan is not null))
);

alter table public.belgeler           enable row level security;
alter table public.belge_dosyalari    enable row level security;
alter table public.belge_satirlari    enable row level security;
alter table public.eslestirme_defteri enable row level security;

-- Patron belgeleri ve satırlarını görür (rapor eksikliği için). Defter fiyat içermez; mekandaki herkes okur.
create policy belge_gor_patron on public.belgeler for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
create policy belge_dosya_gor_patron on public.belge_dosyalari for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
create policy belge_satir_gor_patron on public.belge_satirlari for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
create policy defter_gor on public.eslestirme_defteri for select to authenticated
  using (mekan_id = public.benim_mekanim());

revoke all on public.belgeler, public.belge_dosyalari, public.belge_satirlari, public.eslestirme_defteri
  from anon, authenticated;
grant select on public.belgeler, public.belge_dosyalari, public.belge_satirlari, public.eslestirme_defteri
  to authenticated;

-- Kurulum hesabı tüm belge dosyalarını görebilir (kuyruğu çözerken faturaya bakmak için).
create policy belge_dosyasi_kurulum_gor on storage.objects for select to authenticated
  using (bucket_id = 'fatura-belgeleri' and public.kurulumcu_muyum());
-- Belgelerde XML ve düz metin/CSV (satış raporu) de yüklenebilsin.
update storage.buckets set allowed_mime_types =
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml', 'text/xml',
        'text/plain', 'text/csv']
  where id = 'fatura-belgeleri';

-- ---------- Stoğa ekleme (iç işlem) ----------
-- Bir belge satırını stoğa ekler: belgenin girişini (yoksa) açar, satırı, hareketi ve fiyatı yazar.
create or replace function public.belge_satiri_stokla(p_satir bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  s belge_satirlari;
  b belgeler;
  v_birim text;
  v_haric numeric;
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

  insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani, satir_metni)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari,
            case when s.tutar_haric is not null and s.kdv_orani is not null
                 then round(s.tutar_haric * (1 + s.kdv_orani / 100), 2) end,
            s.tutar_haric, s.kdv_orani, left(s.metin, 200));
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari)
    on conflict (giris_id, malzeme_id) do update set miktar = malzeme_hareketleri.miktar + excluded.miktar;

  if s.tutar_haric > 0 and s.kdv_orani is not null then
    select birim into v_birim from malzemeler where id = s.malzeme_id;
    v_haric := round(s.tutar_haric / s.stok_miktari * (case v_birim when 'adet' then 1 else 1000 end), 4);
    if v_haric < 10000000 then
      insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id,
                                 degistiren, degistiren_ad)
        select b.mekan_id, s.malzeme_id, round(v_haric * (1 + s.kdv_orani / 100), 2), v_haric, s.kdv_orani,
               g.tarih, 'fatura', b.giris_id, b.giren, b.giren_ad
        from girisler g where g.id = b.giris_id;
      perform fiyat_yenile(s.malzeme_id);
    end if;
  end if;
end $$;

-- Belgenin durumunu kalan bekleyen satırlara göre günceller.
create or replace function public.belge_durumu_yenile(p_belge uuid) returns void
language sql security definer set search_path = public as $$
  update belgeler set durum = case
      when tur = 'satis_raporu' then durum
      when exists (select 1 from belge_satirlari where belge_id = p_belge and durum = 'bekliyor') then 'bekliyor'
      else 'tamam' end
  where id = p_belge;
$$;

-- Bir satır stoğa girmeden önce olağandışı mı? (fiyat %30, miktar 3 kat; en az 3 geçmiş fatura)
create or replace function public.satir_olagandisi(p_mekan uuid, p_malzeme uuid, p_stok numeric,
                                                   p_haric numeric, p_oran numeric) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  m malzemeler;
  v_birim_dahil numeric;
  v_medyan numeric;
  v_sayi int;
begin
  select * into m from malzemeler where id = p_malzeme and mekan_id = p_mekan;
  if p_haric > 0 and p_oran is not null and m.fiyat > 0 then
    v_birim_dahil := p_haric * (1 + p_oran / 100) / p_stok * (case m.birim when 'adet' then 1 else 1000 end);
    if abs(v_birim_dahil - m.fiyat) / m.fiyat > 0.30 then return 'fiyat'; end if;
  end if;
  select count(*), percentile_cont(0.5) within group (order by miktar) into v_sayi, v_medyan
    from (select gk.miktar from giris_kalemleri gk join girisler g on g.id = gk.giris_id
          where g.mekan_id = p_mekan and g.tur = 'fatura' and g.iptal_zamani is null
            and gk.malzeme_id = p_malzeme and not gk.stok_disi and gk.miktar > 0
          order by g.tarih desc, g.olusturma desc limit 10) x;
  if v_sayi >= 3 and v_medyan > 0 and (p_stok > v_medyan * 3 or p_stok < v_medyan / 3) then return 'miktar'; end if;
  return null;
end $$;

-- ---------- Belge kaydetme (barista "Mal geldi") ----------
-- p: {istek_id, tur:'fatura', kaynak, dosya_ozeti, ettn, fatura_no, tedarikci, tedarikci_vkn, tarih,
--     toplamlar:{genel, kdv_haric, kdv, indirim}, okunan, dosyalar:[yol], ayni_olabilir_onay:bool,
--     satirlar:[{metin, miktar, birim, birim_fiyat, tutar_haric, kdv_orani,
--                sinif:'eslesti'|'takip_disi'|'belirsiz', malzeme_id, carpan, barista_onayi:bool, aday_malzeme_id}]}
-- Dönen: {id, durum, stoklanan, bekleyen, takip_disi, tekrar:bool}
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
  v_mbirim  text;
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  select ad into v_ad from uyeler where user_id = auth.uid();
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Geçersiz istek.'; end if;

  begin v_istek := (p ->> 'istek_id')::uuid; exception when others then v_istek := null; end;
  if v_istek is null then raise exception 'Geçersiz istek.'; end if;

  -- Tekrar deneme (bağlantı kesildi): aynı istek daha önce kaydedildiyse aynı sonucu dön, ikinci kayıt yok.
  perform pg_advisory_xact_lock(hashtextextended(v_mekan::text || v_istek::text, 0));
  select * into v_onceki from belgeler where mekan_id = v_mekan and istek_id = v_istek;
  if found then
    return jsonb_build_object('id', v_onceki.id, 'durum', v_onceki.durum, 'tekrar', true,
      'stoklanan', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'stokta'),
      'bekleyen', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'bekliyor'),
      'takip_disi', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'takip_disi'));
  end if;

  v_tur := coalesce(p ->> 'tur', 'fatura');
  if v_tur not in ('fatura', 'satis_raporu') then raise exception 'Geçersiz belge türü.'; end if;
  v_kaynak := p ->> 'kaynak';
  if v_kaynak is null or v_kaynak not in ('xml', 'pdf', 'ocr', 'elle', 'dosya') then raise exception 'Geçersiz belge kaynağı.'; end if;
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

  -- KESİN ÇİFT KAYIT: aynı dosya, aynı ETTN ya da aynı tedarikçi + fatura no
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

    -- OLASI ÇİFT KAYIT: aynı tedarikçi + aynı tarih + aynı genel toplam (barista "aynı değil" derse geçer)
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
                        okunan, durum, giren, giren_ad)
    values (v_mekan, v_tur, v_kaynak, v_istek, v_ozet, v_ettn, v_no, v_ted, v_vkn, v_tedanah, v_tarih,
            round(v_genel, 2), round(v_thar, 2), round(v_tkdv, 2), round(v_ind, 2),
            case when jsonb_typeof(p -> 'okunan') = 'object' and pg_column_size(p -> 'okunan') < 300000
                 then p -> 'okunan' end,
            'bekliyor', auth.uid(), coalesce(v_ad, '?'))
    returning id into v_id;

  -- Dosyalar: bu mekanın klasöründe, gerçekten yüklenmiş, başka belgeye bağlı olmayan.
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
    -- Satış raporu şimdilik kurulum kuyruğunda işlenir.
    if not exists (select 1 from belge_dosyalari where belge_id = v_id) then raise exception 'Satış raporunun fotoğrafını ya da dosyasını ekle.'; end if;
    return jsonb_build_object('id', v_id, 'durum', 'bekliyor', 'stoklanan', 0, 'bekleyen', 0, 'takip_disi', 0, 'tekrar', false);
  end if;

  -- Satırlar
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
    v_sum := v_sum + coalesce(v_haric * (1 + coalesce(v_oran, 0) / 100), 0);

    v_durum := 'bekliyor'; v_sebep := 'eslesme'; v_cozen := null; v_stok := null;
    if v_sinif = 'takip_disi' and exists (
         select 1 from eslestirme_defteri
         where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and sonuc = 'takip_disi'
           and tedarikci_anahtar in (v_tedanah, '')) then
      -- "Takip dışı" yalnızca defterde (kurulumun) kaydı varsa kabul edilir; telefon tek başına karar veremez.
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'otomatik'; v_mal := null;
    elsif v_sinif = 'takip_disi' then
      v_aday := null; v_mal := null;   -- defterde yok: kuyrukta bekler
    elsif v_sinif = 'eslesti' and v_mal is not null and v_carpan is not null then
      -- Defterde doğrulanmış kayıt mı, yoksa barista "Evet" mi dedi?
      select * into v_defter from eslestirme_defteri
        where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and sonuc = 'malzeme'
          and tedarikci_anahtar in (v_tedanah, '') and malzeme_id = v_mal and carpan = v_carpan
        order by (tedarikci_anahtar = v_tedanah) desc limit 1;
      if found then
        v_cozen := 'otomatik';
      elsif exists (select 1 from eslestirme_defteri
                    where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and kaynak = 'kurulum'
                      and tedarikci_anahtar in (v_tedanah, '')) then
        v_cozen := null;   -- kurulumun bu metin için başka bir kararı var: barista "Evet"i kabul edilmez, satır bekler
      elsif v_onay then
        v_cozen := 'barista';
        insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, kaynak)
          values (v_mekan, v_tedanah, v_manah, v_birim, 'malzeme', v_mal, v_carpan, 'barista')
          on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
            set sonuc = 'malzeme', malzeme_id = excluded.malzeme_id, carpan = excluded.carpan,
                kaynak = 'barista', guncelleme = now()
            where eslestirme_defteri.kaynak <> 'kurulum';   -- kurulumun kararını barista ezemez
      end if;
      if v_cozen is not null then
        if v_miktar is null or v_miktar = 0 then
          v_sebep := 'eksik';
        else
          v_stok := round(v_miktar * v_carpan, 3);
          if v_haric is null or v_oran is null then
            v_sebep := 'eksik';
          elsif v_bfiyat is not null and abs(v_miktar * v_bfiyat - v_haric) > greatest(1, v_haric * 0.01) then
            v_sebep := 'tutar';
          else
            v_sebep := satir_olagandisi(v_mekan, v_mal, v_stok, v_haric, v_oran);
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
                                 cozen, cozum_zamani)
      values (v_id, v_mekan, v_sira, v_metin, v_manah, v_miktar, v_birim, v_bfiyat, v_haric, v_oran,
              case when v_durum = 'stokta' then 'bekliyor' else v_durum end,      -- stoklama aşağıda (toplam kontrolünden sonra)
              case when v_durum = 'stokta' then 'toplam' else v_sebep end,
              v_aday, v_mal, case when v_mal is not null then v_carpan end, v_stok,
              v_cozen, case when v_cozen is not null then now() end);
  end loop;

  -- TOPLAM KONTROLÜ: tutmazsa hiçbir satır stoğa girmez (kurulum faturaya bakıp onaylar).
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
  select count(*) filter (where durum = 'stokta'), count(*) filter (where durum = 'bekliyor'),
         count(*) filter (where durum = 'takip_disi')
    into v_say_stok, v_say_bekle, v_say_disi from belge_satirlari where belge_id = v_id;
  return jsonb_build_object('id', v_id, 'durum', (select durum from belgeler where id = v_id), 'tekrar', false,
    'toplam_tutuyor', v_tutuyor, 'stoklanan', v_say_stok, 'bekleyen', v_say_bekle, 'takip_disi', v_say_disi);
end $$;

-- ---------- Barista "Geri al" (2 dakika) ----------
-- Kendi girdiği giriş ya da belgeyi 2 dakika içinde geri alır. (Patron her zaman giris_iptal ile iptal edebilir.)
create or replace function public.kaydi_geri_al(p_tur text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g girisler;
  b belgeler;
  v_ad text;
begin
  select ad into v_ad from uyeler where user_id = auth.uid();
  if p_tur = 'giris' then
    select * into g from girisler where id = p_id and mekan_id = benim_mekanim() for update;
    if not found or g.giren <> auth.uid() then raise exception 'Kayıt bulunamadı.'; end if;
    if g.iptal_zamani is not null then return; end if;
    if g.olusturma < now() - interval '2 minutes' then raise exception 'Geri alma süresi doldu. Patrona haber ver.'; end if;
    update girisler set iptal_eden = auth.uid(), iptal_eden_ad = coalesce(v_ad, '?'), iptal_zamani = now() where id = p_id;
  elsif p_tur = 'belge' then
    select * into b from belgeler where id = p_id and mekan_id = benim_mekanim() for update;
    if not found or b.giren <> auth.uid() then raise exception 'Kayıt bulunamadı.'; end if;
    if b.iptal_zamani is not null then return; end if;
    if b.olusturma < now() - interval '2 minutes' then raise exception 'Geri alma süresi doldu. Patrona haber ver.'; end if;
    update belgeler set iptal_eden = auth.uid(), iptal_eden_ad = coalesce(v_ad, '?'), iptal_zamani = now() where id = p_id;
    if b.giris_id is not null then
      update girisler set iptal_eden = auth.uid(), iptal_eden_ad = coalesce(v_ad, '?'), iptal_zamani = now()
        where id = b.giris_id and iptal_zamani is null;
      perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = b.giris_id and malzeme_id is not null;
    end if;
  else
    raise exception 'Geçersiz istek.';
  end if;
end $$;

-- ---------- Fire / sayım / satış: tek seferlik kayıt ----------
-- Telefon her kayıt için bir istek kimliği üretir; bağlantı kesilip tekrar denenince ikinci kayıt oluşmaz.
create table public.giris_istekleri (
  mekan_id  uuid not null references public.mekanlar(id) on delete cascade,
  istek_id  uuid not null,
  giris_id  uuid not null,
  primary key (mekan_id, istek_id),
  foreign key (giris_id, mekan_id) references public.girisler(id, mekan_id)
);
alter table public.giris_istekleri enable row level security;
revoke all on public.giris_istekleri from anon, authenticated;

create or replace function public.giris_kaydet_tek(p_istek uuid, p_tur text, p_tarih date, p_aciklama text, p_kalemler jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_id uuid;
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  if p_istek is null then raise exception 'Geçersiz istek.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_mekan::text || p_istek::text, 0));
  select giris_id into v_id from giris_istekleri where mekan_id = v_mekan and istek_id = p_istek;
  if found then return v_id; end if;
  v_id := giris_kaydet(p_tur, p_tarih, p_aciklama, p_kalemler);
  insert into giris_istekleri (mekan_id, istek_id, giris_id) values (v_mekan, p_istek, v_id);
  return v_id;
end $$;
revoke all on function public.giris_kaydet_tek(uuid, text, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.giris_kaydet_tek(uuid, text, date, text, jsonb) to authenticated;

-- ---------- Patron: rapor eksik mi? ----------
create or replace function public.eksik_belge_ozeti()
returns table (bekleyen_fatura int, bekleyen_satir int, bekleyen_satis_raporu int, en_eski date)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where b.tur = 'fatura')::int,
         coalesce(sum((select count(*) from belge_satirlari s where s.belge_id = b.id and s.durum = 'bekliyor'))
                  filter (where b.tur = 'fatura'), 0)::int,
         count(*) filter (where b.tur = 'satis_raporu')::int,
         min(coalesce(b.belge_tarihi, (b.olusturma at time zone 'Europe/Istanbul')::date))
  from belgeler b
  where b.mekan_id = benim_mekanim() and b.durum = 'bekliyor' and b.iptal_zamani is null
    and patron_muyum()
$$;

-- ---------- Kurulum kuyruğu (yalnız kurulum hesabı) ----------

-- Tüm mekanların bekleyen belgeleri; her biri satırları, dosyaları ve o mekanın malzemeleriyle.
create or replace function public.kurulum_kuyrugu() returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
end $$;

-- Bir bekleyen satırı çöz: malzemeye bağla (çarpan ve gerekirse düzeltilmiş miktar/tutar ile) ya da takip dışı say.
-- p_deftere_yaz: aynı metin sonraki faturalarda otomatik çözülsün.
create or replace function public.kurulum_satir_coz(p_satir bigint, p_sonuc text, p_malzeme uuid, p_carpan numeric,
                                                    p_miktar numeric, p_tutar_haric numeric, p_kdv_orani numeric,
                                                    p_deftere_yaz boolean) returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- "Kalanların hepsi takip dışı": belgede eşleşme bekleyen satırların hepsi takip dışı sayılır ve deftere yazılır
-- (aynı satırlar sonraki faturalarda sorusuz takip dışı olur). Toplam/fiyat/miktar yüzünden bekleyenlere dokunulmaz.
create or replace function public.kurulum_kalanlar_takip_disi(p_belge uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  b belgeler;
  v_sayi int;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  select * into b from belgeler where id = p_belge and iptal_zamani is null;
  if not found then raise exception 'Belge bulunamadı.'; end if;
  insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, kaynak)
    select distinct s.mekan_id, b.tedarikci_anahtar, s.metin_anahtar, coalesce(s.birim, 'diger'), 'takip_disi', 'kurulum'
    from belge_satirlari s
    where s.belge_id = p_belge and s.durum = 'bekliyor' and s.bekleme_sebebi = 'eslesme'
    on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
      set sonuc = 'takip_disi', malzeme_id = null, carpan = null, kaynak = 'kurulum', guncelleme = now();
  update belge_satirlari
    set durum = 'takip_disi', bekleme_sebebi = null, malzeme_id = null, stok_miktari = null,
        cozen = 'kurulum', cozum_zamani = now()
    where belge_id = p_belge and durum = 'bekliyor' and bekleme_sebebi = 'eslesme';
  get diagnostics v_sayi = row_count;
  perform belge_durumu_yenile(p_belge);
  return v_sayi;
end $$;

-- Toplamı tutmayan belge: kurulum faturaya bakıp "rakamlar doğru" der. Eşleşmiş satırlar stoğa girer;
-- eşleşmeyenler kuyrukta kalır. (Gerekirse önce satırlar kurulum_satir_coz ile düzeltilir.)
create or replace function public.kurulum_belge_onayla(p_belge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_satir bigint;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  if not exists (select 1 from belgeler where id = p_belge and iptal_zamani is null) then raise exception 'Belge bulunamadı.'; end if;
  update belgeler set toplam_tutuyor = true where id = p_belge;
  for v_satir in select id from belge_satirlari
                 where belge_id = p_belge and durum = 'bekliyor' and bekleme_sebebi = 'toplam' order by sira loop
    update belge_satirlari set durum = 'stokta', bekleme_sebebi = null, cozen = 'kurulum', cozum_zamani = now()
      where id = v_satir;
    perform belge_satiri_stokla(v_satir);
  end loop;
  perform belge_durumu_yenile(p_belge);
end $$;

-- Yanlış/okunamaz belge: iptal edilir (stoğa etkisi geri alınır). Barista yeniden yükleyebilir.
create or replace function public.kurulum_belge_reddet(p_belge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b belgeler;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  select * into b from belgeler where id = p_belge and iptal_zamani is null for update;
  if not found then raise exception 'Belge bulunamadı.'; end if;
  update belgeler set iptal_eden = auth.uid(), iptal_eden_ad = 'Kurulum', iptal_zamani = now() where id = p_belge;
  if b.giris_id is not null then
    update girisler set iptal_eden = auth.uid(), iptal_eden_ad = 'Kurulum', iptal_zamani = now()
      where id = b.giris_id and iptal_zamani is null;
    perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = b.giris_id and malzeme_id is not null;
  end if;
end $$;

-- Satış raporu işlendi olarak işaretlenir (satışlar ayrıca girildikten sonra).
create or replace function public.kurulum_satis_raporu_tamam(p_belge uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  update belgeler set durum = 'tamam' where id = p_belge and tur = 'satis_raporu' and iptal_zamani is null;
  if not found then raise exception 'Satış raporu bulunamadı.'; end if;
end $$;

-- ---------- Yetkiler ----------
revoke all on function public.metin_anahtari(text), public.kurulumcu_muyum(), public.malzeme_fiyatlari(),
  public.belge_satiri_stokla(bigint), public.belge_durumu_yenile(uuid),
  public.satir_olagandisi(uuid, uuid, numeric, numeric, numeric), public.belge_kaydet(jsonb),
  public.kaydi_geri_al(text, uuid), public.eksik_belge_ozeti(), public.kurulum_kuyrugu(),
  public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean),
  public.kurulum_belge_onayla(uuid), public.kurulum_belge_reddet(uuid), public.kurulum_satis_raporu_tamam(uuid),
  public.kurulum_kalanlar_takip_disi(uuid)
  from public, anon, authenticated;
grant execute on function public.metin_anahtari(text), public.kurulumcu_muyum(), public.malzeme_fiyatlari(),
  public.belge_kaydet(jsonb), public.kaydi_geri_al(text, uuid), public.eksik_belge_ozeti(),
  public.kurulum_kuyrugu(), public.kurulum_satir_coz(bigint, text, uuid, numeric, numeric, numeric, numeric, boolean),
  public.kurulum_belge_onayla(uuid), public.kurulum_belge_reddet(uuid), public.kurulum_satis_raporu_tamam(uuid),
  public.kurulum_kalanlar_takip_disi(uuid)
  to authenticated;

-- ---------- Kurulum hesabını ekleme (bir kez, elle) ----------
-- Kurulum için uygulamada normal bir hesap aç (mekana katılma), sonra e-postasını yazıp şunu çalıştır:
--   insert into public.kurulum_hesaplari (user_id) select id from auth.users where email = 'SENIN@EPOSTAN';
