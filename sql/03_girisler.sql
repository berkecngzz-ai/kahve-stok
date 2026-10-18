-- Adım 3: Günlük girişler (fatura, satış, fire, sayım) ve fiyat geçmişi
-- 02_malzeme_tarif.sql'den SONRA çalıştırılır.
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
--
-- Hiçbir kayıt silinmez: yanlış giriş İPTAL edilir (kim, ne zaman iptal etti saklanır).
-- Miktarlar tariflerle aynı birimde saklanır: g, ml, adet. (Ekran kg/litre/adet gösterir.)

-- Türkiye saatine göre bugünün tarihi.
create or replace function public.bugun() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Istanbul')::date
$$;

-- ---------- Tablolar ----------

-- Her giriş: bir fatura, bir gün sonu satış raporu, bir fire ya da bir sayım.
create table public.girisler (
  id             uuid primary key default gen_random_uuid(),
  mekan_id       uuid not null references public.mekanlar(id) on delete cascade,
  tur            text not null check (tur in ('fatura', 'satis', 'fire', 'sayim')),
  tarih          date not null,
  aciklama       text check (length(aciklama) <= 200),   -- fatura: tedarikçi, fire: sebep
  giren          uuid not null,
  giren_ad       text not null,
  olusturma      timestamptz not null default now(),
  iptal_eden     uuid,
  iptal_eden_ad  text,
  iptal_zamani   timestamptz,
  unique (id, mekan_id)
);
create index girisler_mekan_tarih_idx on public.girisler(mekan_id, tarih desc, olusturma desc);

-- Kullanıcının girdiği satırlar. Satış/ürün firesinde miktar = adet.
create table public.giris_kalemleri (
  id          bigint generated always as identity primary key,
  giris_id    uuid not null,
  mekan_id    uuid not null references public.mekanlar(id) on delete cascade,
  malzeme_id  uuid,
  urun_id     uuid,
  miktar      numeric(16,3) not null check (miktar >= 0),
  tutar       numeric(14,2) check (tutar >= 0),                -- yalnızca fatura: satırın TL tutarı
  check ((malzeme_id is null) <> (urun_id is null)),
  foreign key (giris_id, mekan_id) references public.girisler(id, mekan_id),
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id),
  foreign key (urun_id, mekan_id) references public.urunler(id, mekan_id)
);
create index giris_kalemleri_giris_idx on public.giris_kalemleri(giris_id);
create index giris_kalemleri_mekan_idx on public.giris_kalemleri(mekan_id);

-- Her girişin malzemelere etkisi, giriş anındaki tarife göre hesaplanıp SABİTLENİR.
-- (Patron tarifi sonradan değiştirse de eski günlerin hesabı bozulmaz.)
-- fatura: gelen miktar · satis/fire: harcanan miktar · sayim: sayılan miktar
create table public.malzeme_hareketleri (
  giris_id    uuid not null,
  mekan_id    uuid not null references public.mekanlar(id) on delete cascade,
  malzeme_id  uuid not null,
  miktar      numeric(16,3) not null check (miktar >= 0),
  primary key (giris_id, malzeme_id),
  foreign key (giris_id, mekan_id) references public.girisler(id, mekan_id),
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id)
);
create index malzeme_hareketleri_mekan_idx on public.malzeme_hareketleri(mekan_id, malzeme_id);

-- Her fiyat değişikliği burada kalır (kg / litre / adet fiyatı).
-- baslangic: bu dosya çalıştığında var olan fiyat · elle: patron değiştirdi · fatura: faturadan geldi
create table public.fiyat_gecmisi (
  id             bigint generated always as identity primary key,
  mekan_id       uuid not null references public.mekanlar(id) on delete cascade,
  malzeme_id     uuid not null,
  fiyat          numeric(12,2) not null check (fiyat >= 0),
  tarih          date not null,
  kaynak         text not null check (kaynak in ('baslangic', 'elle', 'fatura')),
  giris_id       uuid,
  degistiren     uuid,
  degistiren_ad  text,
  zaman          timestamptz not null default now(),
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id),
  foreign key (giris_id, mekan_id) references public.girisler(id, mekan_id)
);
create index fiyat_gecmisi_malzeme_idx on public.fiyat_gecmisi(malzeme_id, tarih desc, zaman desc);
create index fiyat_gecmisi_mekan_idx on public.fiyat_gecmisi(mekan_id);

-- Bugüne kadarki fiyatları geçmişin başlangıcı olarak kaydet.
insert into public.fiyat_gecmisi (mekan_id, malzeme_id, fiyat, tarih, kaynak, zaman)
  select mekan_id, id, fiyat, (olusturma at time zone 'Europe/Istanbul')::date, 'baslangic', olusturma
  from public.malzemeler;

-- ---------- İzolasyon (Row Level Security) ----------
-- Herkes yalnızca kendi mekanının kayıtlarını görür. Yazma yalnızca aşağıdaki işlemlerle.

alter table public.girisler            enable row level security;
alter table public.giris_kalemleri     enable row level security;
alter table public.malzeme_hareketleri enable row level security;
alter table public.fiyat_gecmisi       enable row level security;

create policy giris_gor on public.girisler for select to authenticated
  using (mekan_id = public.benim_mekanim());
create policy giris_kalemi_gor on public.giris_kalemleri for select to authenticated
  using (mekan_id = public.benim_mekanim());
create policy hareket_gor on public.malzeme_hareketleri for select to authenticated
  using (mekan_id = public.benim_mekanim());
create policy fiyat_gecmisi_gor on public.fiyat_gecmisi for select to authenticated
  using (mekan_id = public.benim_mekanim());

revoke all on public.girisler, public.giris_kalemleri, public.malzeme_hareketleri, public.fiyat_gecmisi
  from anon, authenticated;
grant select on public.girisler, public.giris_kalemleri, public.malzeme_hareketleri, public.fiyat_gecmisi
  to authenticated;

-- ---------- Fiyat geçmişi ----------

-- Patron fiyatı elle değiştirince (ya da yeni malzeme ekleyince) geçmişe yazar.
create or replace function public.fiyat_kaydi() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('kahve.sistem', true), '') = '1' then return new; end if;
  if tg_op = 'UPDATE' and new.fiyat is not distinct from old.fiyat then return new; end if;
  insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, tarih, kaynak, degistiren, degistiren_ad)
    values (new.mekan_id, new.id, new.fiyat, bugun(), 'elle', auth.uid(),
            (select ad from uyeler where user_id = auth.uid()));
  return new;
end $$;

create trigger malzeme_fiyat_kaydi after insert or update of fiyat on public.malzemeler
  for each row execute function public.fiyat_kaydi();

-- Malzemenin güncel fiyatını geçmişteki en yeni geçerli kayda eşitler
-- (iptal edilmiş faturaların fiyatları sayılmaz; eski tarihli fatura güncel fiyatı ezmez).
create or replace function public.fiyat_yenile(p_malzeme uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_fiyat numeric;
begin
  select f.fiyat into v_fiyat
    from fiyat_gecmisi f left join girisler g on g.id = f.giris_id
    where f.malzeme_id = p_malzeme and g.iptal_zamani is null
    order by f.tarih desc, f.zaman desc, f.id desc limit 1;
  if not found then return; end if;
  perform set_config('kahve.sistem', '1', true);
  update malzemeler set fiyat = v_fiyat where id = p_malzeme and fiyat is distinct from v_fiyat;
  perform set_config('kahve.sistem', '', true);
end $$;

-- ---------- İşlemler ----------

-- Bir girişi satırlarıyla birlikte tek seferde kaydeder. Patron da barista da girebilir.
-- p_kalemler örnekleri (miktarlar g / ml / adet):
--   fatura: [{"malzeme_id": "...", "miktar": 24000, "tutar": 1080}]
--   satis:  [{"urun_id": "...", "miktar": 48}]
--   fire:   [{"malzeme_id": "...", "miktar": 500}, {"urun_id": "...", "miktar": 1}]
--   sayim:  [{"malzeme_id": "...", "miktar": 12500}]
create or replace function public.giris_kaydet(p_tur text, p_tarih date, p_aciklama text, p_kalemler jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mekan  uuid := benim_mekanim();
  v_ad     text;
  v_id     uuid;
  k        jsonb;
  v_mal    uuid;
  v_urun   uuid;
  v_birim  text;
  v_miktar numeric;
  v_tutar  numeric;
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  select ad into v_ad from uyeler where user_id = auth.uid();
  if p_tur is null or p_tur not in ('fatura', 'satis', 'fire', 'sayim') then
    raise exception 'Geçersiz giriş türü.';
  end if;
  if p_tarih is null then raise exception 'Tarih seç.'; end if;
  if p_tarih > bugun() then raise exception 'Tarih bugünden ileri olamaz.'; end if;
  if p_tarih < bugun() - 366 then raise exception 'Tarih en fazla bir yıl geriye gidebilir.'; end if;
  p_aciklama := nullif(trim(p_aciklama), '');
  if length(p_aciklama) > 200 then raise exception 'Açıklama en fazla 200 karakter olabilir.'; end if;
  if p_tur = 'fire' and p_aciklama is null then raise exception 'Fire sebebini seç.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir satır gir.';
  end if;
  if jsonb_array_length(p_kalemler) > 300 then raise exception 'Bir girişte en fazla 300 satır olabilir.'; end if;

  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad)
    values (v_mekan, p_tur, p_tarih, p_aciklama, auth.uid(), coalesce(v_ad, '?'))
    returning id into v_id;

  for k in select value from jsonb_array_elements(p_kalemler) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    v_mal := null; v_urun := null; v_birim := null;
    if p_tur <> 'satis' then
      select id, birim into v_mal, v_birim from malzemeler
        where id::text = k ->> 'malzeme_id' and mekan_id = v_mekan;
    end if;
    if p_tur in ('satis', 'fire') then
      select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = v_mekan;
    end if;
    if (v_mal is null) = (v_urun is null) or (k ? 'malzeme_id') <> (v_mal is not null)
       or (k ? 'urun_id') <> (v_urun is not null) then
      raise exception 'Satırlarda geçersiz bir malzeme ya da ürün var.';
    end if;

    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then (k ->> 'miktar')::numeric end;
    if v_urun is not null then
      if v_miktar is null or v_miktar <> trunc(v_miktar) or v_miktar not between 1 and 100000 then
        raise exception 'Ürün adetleri 1 ile 100.000 arasında tam sayı olmalı.';
      end if;
    elsif p_tur = 'sayim' then
      if v_miktar is null or v_miktar < 0 or v_miktar >= 10000000000 then
        raise exception 'Sayım miktarları 0 ya da daha büyük bir sayı olmalı.';
      end if;
    elsif v_miktar is null or v_miktar < 0.001 or v_miktar >= 10000000000 then
      raise exception 'Miktarlar 0''dan büyük bir sayı olmalı.';
    end if;

    v_tutar := null;
    if p_tur = 'fatura' then
      v_tutar := case when jsonb_typeof(k -> 'tutar') = 'number' then (k ->> 'tutar')::numeric end;
      if v_tutar is null or v_tutar < 0 or v_tutar >= 1000000000 then
        raise exception 'Fatura tutarları 0 ya da daha büyük bir sayı olmalı.';
      end if;
      if v_tutar / v_miktar * (case v_birim when 'adet' then 1 else 1000 end) >= 10000000 then
        raise exception 'Bir satırın birim fiyatı çok yüksek çıkıyor. Miktarı ve tutarı kontrol et.';
      end if;
    end if;

    insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, urun_id, miktar, tutar)
      values (v_id, v_mekan, v_mal, v_urun, round(v_miktar, 3), round(v_tutar, 2));
  end loop;

  if exists (select 1 from giris_kalemleri where giris_id = v_id
             group by coalesce(malzeme_id, urun_id) having count(*) > 1) then
    raise exception 'Aynı malzeme ya da ürün iki satırda var. Tek satırda topla.';
  end if;

  -- Malzemelere etkisi (ürünler giriş anındaki tarifle malzemeye çevrilir).
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    select v_id, v_mekan, x.malzeme_id, sum(x.miktar)
    from (
      select gk.malzeme_id, gk.miktar from giris_kalemleri gk
        where gk.giris_id = v_id and gk.malzeme_id is not null
      union all
      select t.malzeme_id, t.miktar * gk.miktar from giris_kalemleri gk
        join tarif_kalemleri t on t.urun_id = gk.urun_id
        where gk.giris_id = v_id and gk.urun_id is not null
    ) x
    group by x.malzeme_id;

  -- Faturadaki fiyatlar geçmişe yazılır; güncel fiyat en yeni tarihli kayda göre ayarlanır.
  if p_tur = 'fatura' then
    insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, tarih, kaynak, giris_id, degistiren, degistiren_ad)
      select v_mekan, gk.malzeme_id,
             round(gk.tutar / gk.miktar * (case m.birim when 'adet' then 1 else 1000 end), 2),
             p_tarih, 'fatura', v_id, auth.uid(), v_ad
      from giris_kalemleri gk join malzemeler m on m.id = gk.malzeme_id
      where gk.giris_id = v_id and gk.tutar > 0;
    perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = v_id and tutar > 0;
  end if;

  return v_id;
end $$;

-- Girişi iptal eder (silmez). Patron her kaydı; barista yalnızca kendi girdiğini, aynı gün iptal edebilir.
create or replace function public.giris_iptal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g girisler;
begin
  select * into g from girisler where id = p_id and mekan_id = benim_mekanim() for update;
  if not found then raise exception 'Kayıt bulunamadı.'; end if;
  if g.iptal_zamani is not null then raise exception 'Bu kayıt zaten iptal edilmiş.'; end if;
  if not patron_muyum() and (g.giren is distinct from auth.uid()
      or (g.olusturma at time zone 'Europe/Istanbul')::date <> bugun()) then
    raise exception 'Barista yalnızca kendi girdiği kaydı aynı gün iptal edebilir. Bu kaydı patron iptal edebilir.';
  end if;
  update girisler
    set iptal_eden = auth.uid(),
        iptal_eden_ad = coalesce((select ad from uyeler where user_id = auth.uid()), '?'),
        iptal_zamani = now()
    where id = p_id;
  if g.tur = 'fatura' then
    perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = p_id and tutar > 0;
  end if;
end $$;

-- İç fonksiyonlar dışarıdan çağrılamaz; yalnızca giriş/iptal giriş yapmış kullanıcılara açık.
revoke all on function public.bugun(), public.fiyat_kaydi(), public.fiyat_yenile(uuid),
  public.giris_kaydet(text, date, text, jsonb), public.giris_iptal(uuid) from public, anon, authenticated;
grant execute on function public.bugun(), public.giris_kaydet(text, date, text, jsonb), public.giris_iptal(uuid)
  to authenticated;
