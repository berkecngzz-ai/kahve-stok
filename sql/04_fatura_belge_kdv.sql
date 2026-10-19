-- Adım 4 / Parça 1: KDV'li fatura, fatura belgeleri (fotoğraf/PDF) ve fatura kontrolleri
-- 03_girisler.sql'den SONRA çalıştırılır.
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
--
-- KDV kuralı: KDV hariç tutar ve KDV oranı ayrı saklanır; KDV dahil tutar bunlardan hesaplanır.
-- "fiyat" sütunu her yerde KDV DAHİL birim fiyattır (eski kayıtlarla uyumlu).
-- Eski kayıtlarda KDV oranı bilinmiyor (kdv_orani boş); hiçbir eski kayıt değiştirilmez.

-- ---------- Mekan ayarı: raporlarda KDV dahil mi, hariç mi ----------

alter table public.mekanlar
  add column kdv_gosterim text not null default 'dahil' check (kdv_gosterim in ('dahil', 'haric'));

create or replace function public.kdv_gosterim_ayarla(p_deger text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not patron_muyum() then raise exception 'Bu işlemi yalnızca patron yapabilir.'; end if;
  if p_deger is null or p_deger not in ('dahil', 'haric') then raise exception 'Geçersiz seçim.'; end if;
  update mekanlar set kdv_gosterim = p_deger where id = benim_mekanim();
end $$;

-- ---------- Malzeme fiyatında KDV ----------

alter table public.malzemeler
  add column fiyat_haric numeric(14,4) check (fiyat_haric >= 0 and fiyat_haric < 10000000),
  add column kdv_orani   numeric(5,2)  check (kdv_orani between 0 and 100);

-- Oran biliniyorsa KDV dahil fiyat her zaman hariç fiyat + orandan hesaplanır (elle tutarsızlık olamaz).
create or replace function public.malzeme_kdv_hesapla() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.kdv_orani is null then
    new.fiyat_haric := null;
  else
    -- Yalnızca KDV dahil fiyat değiştirildiyse (eski ekran), hariç fiyatı ondan geri hesapla.
    if tg_op = 'UPDATE' and new.fiyat is distinct from old.fiyat
       and new.fiyat_haric is not distinct from old.fiyat_haric
       and new.kdv_orani is not distinct from old.kdv_orani then
      new.fiyat_haric := round(new.fiyat / (1 + new.kdv_orani / 100), 4);
    end if;
    if new.fiyat_haric is null then raise exception 'KDV hariç fiyat eksik.'; end if;
    new.fiyat := round(new.fiyat_haric * (1 + new.kdv_orani / 100), 2);
  end if;
  return new;
end $$;
create trigger malzeme_kdv_hesapla before insert or update on public.malzemeler
  for each row execute function public.malzeme_kdv_hesapla();

grant update (fiyat_haric, kdv_orani) on public.malzemeler to authenticated;

alter table public.fiyat_gecmisi
  add column fiyat_haric numeric(14,4),
  add column kdv_orani   numeric(5,2);

-- Fiyat geçmişi tetikleyicisi artık KDV bilgisini de yazar.
drop trigger malzeme_fiyat_kaydi on public.malzemeler;
create or replace function public.fiyat_kaydi() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('kahve.sistem', true), '') = '1' then return new; end if;
  if tg_op = 'UPDATE' and new.fiyat is not distinct from old.fiyat
     and new.fiyat_haric is not distinct from old.fiyat_haric
     and new.kdv_orani is not distinct from old.kdv_orani then
    return new;
  end if;
  insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, degistiren, degistiren_ad)
    values (new.mekan_id, new.id, new.fiyat, new.fiyat_haric, new.kdv_orani, bugun(), 'elle', auth.uid(),
            (select ad from uyeler where user_id = auth.uid()));
  return new;
end $$;
create trigger malzeme_fiyat_kaydi after insert or update of fiyat, fiyat_haric, kdv_orani on public.malzemeler
  for each row execute function public.fiyat_kaydi();

-- Güncel fiyat = geçmişteki en yeni geçerli kayıt (iptal edilmiş faturalar sayılmaz).
create or replace function public.fiyat_yenile(p_malzeme uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select fg.fiyat, fg.fiyat_haric, fg.kdv_orani into f
    from fiyat_gecmisi fg left join girisler g on g.id = fg.giris_id
    where fg.malzeme_id = p_malzeme and g.iptal_zamani is null
    order by fg.tarih desc, fg.zaman desc, fg.id desc limit 1;
  if not found then return; end if;
  perform set_config('kahve.sistem', '1', true);
  update malzemeler set fiyat = f.fiyat, fiyat_haric = f.fiyat_haric, kdv_orani = f.kdv_orani
    where id = p_malzeme
      and (fiyat, fiyat_haric, kdv_orani) is distinct from (f.fiyat, f.fiyat_haric, f.kdv_orani);
  perform set_config('kahve.sistem', '', true);
end $$;

-- ---------- Faturanın KDV'li satırları ve alt toplamları ----------

alter table public.girisler
  add column belge_genel_toplam    numeric(14,2) check (belge_genel_toplam >= 0),
  add column belge_kdv_haric_toplam numeric(14,2) check (belge_kdv_haric_toplam >= 0),
  add column belge_kdv_toplam      numeric(14,2) check (belge_kdv_toplam >= 0),
  add column belge_indirim         numeric(14,2) check (belge_indirim >= 0);

-- Satırlar: tutar = KDV dahil (eski kayıtlarda da böyleydi). Yeni faturalarda hariç tutar + oran da var.
-- Stok dışı satır (deterjan, peçete…): malzemesi yok, stoğa eklenmez ama toplam kontrolünde sayılır.
alter table public.giris_kalemleri
  add column tutar_kdv_haric numeric(14,2) check (tutar_kdv_haric >= 0),
  add column kdv_orani       numeric(5,2)  check (kdv_orani between 0 and 100),
  add column stok_disi       boolean not null default false,
  add column satir_metni     text check (length(satir_metni) <= 200),
  add column uyarilar        text[];   -- baristanın kontrol edip onayladığı uyarılar (iz için)
alter table public.giris_kalemleri drop constraint giris_kalemleri_check;
alter table public.giris_kalemleri add constraint giris_kalemleri_secim_check check (
  case when stok_disi then malzeme_id is null and urun_id is null and satir_metni is not null
       else (malzeme_id is null) <> (urun_id is null) end);

-- ---------- Fatura belgeleri (fotoğraf / PDF) ----------
-- Dosyalar Supabase Storage'da gizli bir kovada: <mekan_id>/<taslak>/<dosya>.
-- Her mekan yalnızca kendi klasörüne yükler ve yalnızca kendi klasörünü görür. Silme/değiştirme yok.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('fatura-belgeleri', 'fatura-belgeleri', false, 5242880,
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

create policy fatura_belgesi_yukle on storage.objects for insert to authenticated
  with check (bucket_id = 'fatura-belgeleri'
              and (storage.foldername(name))[1] = public.benim_mekanim()::text);
create policy fatura_belgesi_gor on storage.objects for select to authenticated
  using (bucket_id = 'fatura-belgeleri'
         and (storage.foldername(name))[1] = public.benim_mekanim()::text);

create table public.giris_belgeleri (
  id         bigint generated always as identity primary key,
  giris_id   uuid not null,
  mekan_id   uuid not null references public.mekanlar(id) on delete cascade,
  yol        text not null unique,
  tur        text not null check (tur in ('foto', 'pdf')),
  olusturma  timestamptz not null default now(),
  foreign key (giris_id, mekan_id) references public.girisler(id, mekan_id)
);
create index giris_belgeleri_giris_idx on public.giris_belgeleri(giris_id);
create index giris_belgeleri_mekan_idx on public.giris_belgeleri(mekan_id);

alter table public.giris_belgeleri enable row level security;
create policy belge_gor on public.giris_belgeleri for select to authenticated
  using (mekan_id = public.benim_mekanim());
revoke all on public.giris_belgeleri from anon, authenticated;
grant select on public.giris_belgeleri to authenticated;

-- ---------- Uyarılar için geçmiş bilgisi ----------
-- Her malzeme için: son 10 geçerli faturadaki miktarların ortancası, fatura sayısı, son KDV oranı.
create or replace function public.fatura_referanslari()
returns table (malzeme_id uuid, fatura_sayisi int, medyan_miktar numeric, son_kdv_orani numeric)
language sql stable security invoker set search_path = public as $$
  with son as (
    select gk.malzeme_id, gk.miktar, gk.kdv_orani,
           row_number() over (partition by gk.malzeme_id order by g.tarih desc, g.olusturma desc) as sira
    from giris_kalemleri gk join girisler g on g.id = gk.giris_id
    where g.mekan_id = benim_mekanim() and g.tur = 'fatura' and g.iptal_zamani is null
      and gk.malzeme_id is not null and not gk.stok_disi and gk.miktar > 0
  )
  select malzeme_id, count(*)::int,
         (percentile_cont(0.5) within group (order by miktar))::numeric,
         (array_agg(kdv_orani order by sira) filter (where kdv_orani is not null))[1]
  from son where sira <= 10
  group by malzeme_id
$$;

-- ---------- Fatura kaydetme ----------
-- p_kalemler: [{"malzeme_id": "...", "miktar": 24000, "tutar_kdv_haric": 1188.12, "kdv_orani": 1,
--               "uyarilar": ["fiyat"]},
--              {"stok_disi": true, "satir_metni": "Deterjan", "tutar_kdv_haric": 100, "kdv_orani": 20}]
-- p_toplamlar: {"genel": 1320, "kdv_haric": 1288.12, "kdv": 31.88, "indirim": 0}   (genel zorunlu)
-- p_belgeler:  ["<mekan_id>/<taslak>/1.jpg", ...]   (önceden Storage'a yüklenmiş, en fazla 5)
-- Toplam tutmazsa KAYDETMEZ (telefondaki kontrol atlansa bile).
create or replace function public.fatura_kaydet(p_tarih date, p_tedarikci text, p_kalemler jsonb,
                                                p_toplamlar jsonb, p_belgeler jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mekan    uuid := benim_mekanim();
  v_ad       text;
  v_id       uuid;
  k          jsonb;
  v_mal      uuid;
  v_birim    text;
  v_stokdisi boolean;
  v_metin    text;
  v_miktar   numeric;
  v_haric    numeric;
  v_oran     numeric;
  v_genel    numeric;
  v_thar     numeric;
  v_tkdv     numeric;
  v_indirim  numeric;
  v_sum_har  numeric;
  v_sum_dah  numeric;
  v_oranlar  int;
  v_pay      numeric;
  v_yol      text;
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  select ad into v_ad from uyeler where user_id = auth.uid();
  if p_tarih is null then raise exception 'Tarih seç.'; end if;
  if p_tarih > bugun() then raise exception 'Tarih bugünden ileri olamaz.'; end if;
  if p_tarih < bugun() - 366 then raise exception 'Tarih en fazla bir yıl geriye gidebilir.'; end if;
  p_tedarikci := nullif(trim(p_tedarikci), '');
  if length(p_tedarikci) > 200 then raise exception 'Tedarikçi adı en fazla 200 karakter olabilir.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir satır gir.';
  end if;
  if jsonb_array_length(p_kalemler) > 300 then raise exception 'Bir faturada en fazla 300 satır olabilir.'; end if;

  -- Alt toplamlar
  if jsonb_typeof(p_toplamlar) is distinct from 'object' then raise exception 'Faturanın genel toplamını yaz.'; end if;
  v_genel   := case when jsonb_typeof(p_toplamlar -> 'genel') = 'number' then (p_toplamlar ->> 'genel')::numeric end;
  v_thar    := case when jsonb_typeof(p_toplamlar -> 'kdv_haric') = 'number' then (p_toplamlar ->> 'kdv_haric')::numeric end;
  v_tkdv    := case when jsonb_typeof(p_toplamlar -> 'kdv') = 'number' then (p_toplamlar ->> 'kdv')::numeric end;
  v_indirim := coalesce(case when jsonb_typeof(p_toplamlar -> 'indirim') = 'number'
                             then (p_toplamlar ->> 'indirim')::numeric end, 0);
  if v_genel is null or v_genel < 0 or v_genel >= 1000000000 then raise exception 'Faturanın genel toplamını yaz.'; end if;
  if v_thar < 0 or v_thar >= 1000000000 or v_tkdv < 0 or v_tkdv >= 1000000000
     or v_indirim < 0 or v_indirim >= 1000000000 then
    raise exception 'Fatura alt toplamları 0 ya da daha büyük bir sayı olmalı.';
  end if;

  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad,
                        belge_genel_toplam, belge_kdv_haric_toplam, belge_kdv_toplam, belge_indirim)
    values (v_mekan, 'fatura', p_tarih, p_tedarikci, auth.uid(), coalesce(v_ad, '?'),
            round(v_genel, 2), round(v_thar, 2), round(v_tkdv, 2), round(v_indirim, 2))
    returning id into v_id;

  for k in select value from jsonb_array_elements(p_kalemler) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    v_stokdisi := coalesce(case when jsonb_typeof(k -> 'stok_disi') = 'boolean'
                                then (k ->> 'stok_disi')::boolean end, false);
    v_mal := null; v_birim := null; v_metin := null;
    if v_stokdisi then
      v_metin := nullif(trim(k ->> 'satir_metni'), '');
      if v_metin is null or length(v_metin) > 200 or k ? 'malzeme_id' then
        raise exception 'Stoğa eklenmeyen satırlara ne olduğunu yaz (örn. Deterjan).';
      end if;
      v_miktar := 0;
    else
      select id, birim into v_mal, v_birim from malzemeler
        where id::text = k ->> 'malzeme_id' and mekan_id = v_mekan;
      if v_mal is null then raise exception 'Satırlarda geçersiz bir malzeme var.'; end if;
      v_metin := nullif(trim(k ->> 'satir_metni'), '');
      if length(v_metin) > 200 then v_metin := left(v_metin, 200); end if;
      v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then (k ->> 'miktar')::numeric end;
      if v_miktar is null or v_miktar < 0.001 or v_miktar >= 10000000000 then
        raise exception 'Miktarlar 0''dan büyük bir sayı olmalı.';
      end if;
    end if;

    v_haric := case when jsonb_typeof(k -> 'tutar_kdv_haric') = 'number' then (k ->> 'tutar_kdv_haric')::numeric end;
    v_oran  := case when jsonb_typeof(k -> 'kdv_orani') = 'number' then (k ->> 'kdv_orani')::numeric end;
    if v_haric is null or v_haric < 0 or v_haric >= 1000000000 then
      raise exception 'Satır tutarları (KDV hariç) 0 ya da daha büyük bir sayı olmalı.';
    end if;
    if v_oran is null or v_oran < 0 or v_oran > 100 then raise exception 'Her satır için KDV oranını seç.'; end if;
    if not v_stokdisi and v_haric / v_miktar * (case v_birim when 'adet' then 1 else 1000 end) >= 10000000 then
      raise exception 'Bir satırın birim fiyatı çok yüksek çıkıyor. Miktarı ve tutarı kontrol et.';
    end if;

    insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani,
                                 stok_disi, satir_metni, uyarilar)
      values (v_id, v_mekan, v_mal, round(v_miktar, 3), round(round(v_haric, 2) * (1 + v_oran / 100), 2),
              round(v_haric, 2), v_oran, v_stokdisi, v_metin,
              (select array_agg(left(x, 40)) from jsonb_array_elements_text(
                 case when jsonb_typeof(k -> 'uyarilar') = 'array' then k -> 'uyarilar' else '[]' end) x));
  end loop;

  if exists (select 1 from giris_kalemleri where giris_id = v_id and not stok_disi
             group by malzeme_id having count(*) > 1) then
    raise exception 'Aynı malzeme iki satırda var. Tek satırda topla.';
  end if;

  -- TOPLAM KONTROLÜ. Kuruş yuvarlamaları için pay: 1 TL (çok satırlı faturada satır başına 1 kuruş, hangisi büyükse);
  -- KDV toplamında oran başına bu kadar.
  select sum(tutar_kdv_haric), sum(tutar), count(distinct kdv_orani), greatest(1, 0.01 * count(*))
    into v_sum_har, v_sum_dah, v_oranlar, v_pay
    from giris_kalemleri where giris_id = v_id;
  if abs(v_sum_dah - v_indirim - v_genel) > v_pay then
    raise exception 'Satırların toplamı (% TL) faturanın genel toplamı (% TL) ile tutmuyor. Fark: % TL. Eksik ya da yanlış bir satır olabilir.',
      replace(to_char(v_sum_dah - v_indirim, 'FM999999999990.00'), '.', ','), replace(to_char(v_genel, 'FM999999999990.00'), '.', ','),
      replace(to_char(abs(v_sum_dah - v_indirim - v_genel), 'FM999999999990.00'), '.', ',');
  end if;
  if v_thar is not null and abs(v_sum_har - v_thar) > v_pay then
    raise exception 'Satırların KDV hariç toplamı (% TL) faturadaki KDV hariç toplam (% TL) ile tutmuyor.',
      replace(to_char(v_sum_har, 'FM999999999990.00'), '.', ','), replace(to_char(v_thar, 'FM999999999990.00'), '.', ',');
  end if;
  if v_tkdv is not null and abs((v_sum_dah - v_sum_har) - v_tkdv) > v_pay * v_oranlar then
    raise exception 'Satırlardan hesaplanan KDV (% TL) faturadaki KDV toplamı (% TL) ile tutmuyor. KDV oranlarını kontrol et.',
      replace(to_char(v_sum_dah - v_sum_har, 'FM999999999990.00'), '.', ','), replace(to_char(v_tkdv, 'FM999999999990.00'), '.', ',');
  end if;
  if v_thar is not null and v_tkdv is not null and abs(v_thar + v_tkdv - v_indirim - v_genel) > v_pay then
    raise exception 'Faturadaki alt toplamlar birbirini tutmuyor (KDV hariç + KDV − indirim ≠ genel toplam). Rakamları kontrol et.';
  end if;

  -- Belgeler: bu mekanın klasöründe, gerçekten yüklenmiş ve başka faturaya bağlanmamış olmalı.
  if p_belgeler is not null and jsonb_typeof(p_belgeler) <> 'null' then
    if jsonb_typeof(p_belgeler) <> 'array' then raise exception 'Geçersiz belge listesi.'; end if;
    if jsonb_array_length(p_belgeler) > 5 then raise exception 'Bir faturaya en fazla 5 belge eklenebilir.'; end if;
    for v_yol in select value from jsonb_array_elements_text(p_belgeler) loop
      if split_part(v_yol, '/', 1) <> v_mekan::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'fatura-belgeleri' and o.name = v_yol) then
        raise exception 'Belge bulunamadı. Fotoğrafı tekrar ekle.';
      end if;
      if exists (select 1 from giris_belgeleri where yol = v_yol) then
        raise exception 'Bu belge başka bir faturaya bağlı.';
      end if;
      insert into giris_belgeleri (giris_id, mekan_id, yol, tur)
        values (v_id, v_mekan, v_yol, case when lower(v_yol) like '%.pdf' then 'pdf' else 'foto' end);
    end loop;
  end if;

  -- Stoğa etkisi (stok dışı satırlar hariç)
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    select v_id, v_mekan, malzeme_id, miktar from giris_kalemleri
    where giris_id = v_id and not stok_disi;

  -- Fiyat geçmişi: KDV hariç birim fiyat + oran; KDV dahil fiyat bunlardan hesaplanır.
  insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id,
                             degistiren, degistiren_ad)
    select v_mekan, gk.malzeme_id, round(x.haric * (1 + gk.kdv_orani / 100), 2), x.haric, gk.kdv_orani,
           p_tarih, 'fatura', v_id, auth.uid(), v_ad
    from giris_kalemleri gk
    join malzemeler m on m.id = gk.malzeme_id
    cross join lateral (select round(gk.tutar_kdv_haric / gk.miktar
                                     * (case m.birim when 'adet' then 1 else 1000 end), 4) as haric) x
    where gk.giris_id = v_id and not gk.stok_disi and gk.tutar_kdv_haric > 0;
  perform fiyat_yenile(malzeme_id) from giris_kalemleri
    where giris_id = v_id and not stok_disi and tutar_kdv_haric > 0;

  return v_id;
end $$;

-- Eski fatura girişi kapatılır (yeni fatura ekranı kullanılmalı). Satış, fire, sayım aynen devam eder.
alter function public.giris_kaydet(text, date, text, jsonb) rename to giris_kaydet_v1;
create or replace function public.giris_kaydet(p_tur text, p_tarih date, p_aciklama text, p_kalemler jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if p_tur = 'fatura' then
    raise exception 'Fatura ekranı güncellendi. Sayfayı yenileyip tekrar dene.';
  end if;
  return giris_kaydet_v1(p_tur, p_tarih, p_aciklama, p_kalemler);
end $$;

-- ---------- Yetkiler ----------
revoke all on function public.kdv_gosterim_ayarla(text), public.malzeme_kdv_hesapla(),
  public.fiyat_kaydi(), public.fiyat_yenile(uuid), public.fatura_referanslari(),
  public.fatura_kaydet(date, text, jsonb, jsonb, jsonb),
  public.giris_kaydet_v1(text, date, text, jsonb), public.giris_kaydet(text, date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.kdv_gosterim_ayarla(text), public.fatura_referanslari(),
  public.fatura_kaydet(date, text, jsonb, jsonb, jsonb), public.giris_kaydet(text, date, text, jsonb)
  to authenticated;
