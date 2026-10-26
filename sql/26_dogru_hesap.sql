-- 26: Hesap doğruluğu (2026-10-26). Beklenen = başlangıç sayımı + mal girişi − satış tüketimi − fire; açık = beklenen − sayılan.
--  1. Reçete sürümleri: tarif_surumleri (urun, başlangıç tarihi). Satış, SATIŞ GÜNÜNDE geçerli sürümle hesaplanır;
--     reçete değişince geçmiş satış günleri yeniden hesaplanmaz (hareketler saklı), geç gelen satır ise kendi gününün sürümüyle.
--  2. POS satır bazında: satis_satirlari (fiş no → yoksa saat+ürün+adet+tutar → yoksa gün+ürün+adet+tutar). Aynı satır
--     ikinci kez gelirse atlanır ve sayısı bildirilir. Her gün için tek satış girişi; günün tüketimi satırlardan yeniden kurulur.
--  3. İptal (hazırlanmadan): aynı fiş/saat/gün grubundaki satışı düşer, en fazla satış kadar (stok iki kez artmaz).
--     İade (verildikten sonra para iadesi) ve türü belirsiz eksi satır: stoğa etkisi yok.
--  4. Fatura teslim tarihi düzeltilebilir (fatura_teslim_tarihi); raporlar hareket tarihine göre yeniden hesaplanır.
--  5. Hatalı sayım düzeltilir (sayim_duzelt); kim / ne zaman / eski / yeni işlem geçmişine yazılır.
--  6. TL: ağırlıklı ortalama alış maliyeti (son 90 gün, doğrulanmış fatura kalemleri; yoksa malzemenin kayıtlı fiyatı).
--  7. Reçetesiz ürün satışı: rapor uyarısı + patron/barista ekranında görünür (tarifsiz_satislar).
--  8. Günlük süt sayımı haftalık raporu bozmaz: geniş (2+ malzemeli) sayımın raporu bir önceki geniş sayımdan başlar.
-- Geri alma: scripts/geri-al-26.sql

-- ================================ 1. Reçete sürümleri ================================
create table if not exists public.tarif_surumleri (
  id         bigint generated always as identity primary key,
  mekan_id   uuid not null references public.mekanlar(id) on delete cascade,
  urun_id    uuid not null,
  baslangic  date not null,
  malzeme_id uuid not null,
  miktar     numeric(12,3) not null check (miktar > 0),
  olusturma  timestamptz not null default now(),
  unique (urun_id, baslangic, malzeme_id),
  foreign key (urun_id, mekan_id) references public.urunler(id, mekan_id) on delete cascade,
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id)
);
create index if not exists tarif_surumleri_urun_idx on public.tarif_surumleri(urun_id, baslangic);
alter table public.tarif_surumleri enable row level security;
drop policy if exists tarif_surumu_gor on public.tarif_surumleri;
create policy tarif_surumu_gor on public.tarif_surumleri for select to authenticated using (mekan_id = public.benim_mekanim());
revoke all on public.tarif_surumleri from anon, authenticated;
grant select on public.tarif_surumleri to authenticated;

-- Mevcut tarifler ilk sürüm olur (geçmişin tamamına geçerli).
insert into public.tarif_surumleri (mekan_id, urun_id, baslangic, malzeme_id, miktar)
  select u.mekan_id, t.urun_id, date '2000-01-01', t.malzeme_id, t.miktar
  from public.tarif_kalemleri t join public.urunler u on u.id = t.urun_id
  on conflict do nothing;

-- Bir ürünün p_tarih gününde geçerli reçetesi: o gün ya da öncesindeki en yeni sürüm; o tarihten önce sürüm yoksa ilk sürüm.
create or replace function public.tarif_gecerli(p_urun uuid, p_tarih date)
returns table (malzeme_id uuid, miktar numeric) language sql stable security definer set search_path = public as $$
  select t.malzeme_id, t.miktar from tarif_surumleri t
  where t.urun_id = p_urun and t.baslangic = coalesce(
    (select max(baslangic) from tarif_surumleri where urun_id = p_urun and baslangic <= p_tarih),
    (select min(baslangic) from tarif_surumleri where urun_id = p_urun))
$$;

-- p_gecerli: reçetenin geçerli olduğu ilk gün (boşsa bugün). Aynı güne ikinci kayıt o günün sürümünü değiştirir.
create or replace function public.urun_kaydet(p_id uuid, p_ad text, p_kalemler jsonb, p_gecerli date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_id uuid;
  v_adet int;
  v_gecerli date := coalesce(p_gecerli, bugun());
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Bu işlemi yalnızca patron yapabilir.'; end if;
  if coalesce(trim(p_ad), '') = '' then raise exception 'Ürün adı boş olamaz.'; end if;
  if length(trim(p_ad)) > 60 then raise exception 'Ürün adı en fazla 60 karakter olabilir.'; end if;
  if v_gecerli > bugun() or v_gecerli < bugun() - 366 then raise exception 'Reçetenin geçerli olduğu tarih bugünden ileri ya da bir yıldan eski olamaz.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Tarife en az bir malzeme ekle.';
  end if;
  if jsonb_array_length(p_kalemler) > 50 then raise exception 'Bir tarifte en fazla 50 malzeme olabilir.'; end if;
  if exists (select 1 from jsonb_array_elements(p_kalemler) k
             where coalesce(case when jsonb_typeof(k -> 'miktar') = 'number' then (k ->> 'miktar')::numeric end, 0)
                   not between 0.001 and 99999.999) then
    raise exception 'Tarifteki miktarlar 0''dan büyük bir sayı olmalı.';
  end if;
  select count(distinct m.id) into v_adet from jsonb_array_elements(p_kalemler) k
    join malzemeler m on m.id::text = k ->> 'malzeme_id' and m.mekan_id = v_mekan;
  if v_adet <> jsonb_array_length(p_kalemler) then raise exception 'Tarifte geçersiz ya da iki kez yazılmış bir malzeme var.'; end if;

  begin
    if p_id is null then
      insert into urunler (mekan_id, ad) values (v_mekan, trim(p_ad)) returning id into v_id;
    else
      update urunler set ad = trim(p_ad) where id = p_id and mekan_id = v_mekan returning id into v_id;
      if v_id is null then raise exception 'Ürün bulunamadı.'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Bu adla bir ürün zaten var.';
  end;

  -- Güncel reçete (ekranlar için) = en yeni sürüm. Geçmiş tarihli bir düzeltme güncel reçeteyi değiştirmez.
  delete from tarif_surumleri where urun_id = v_id and baslangic = v_gecerli;
  insert into tarif_surumleri (mekan_id, urun_id, baslangic, malzeme_id, miktar)
    select v_mekan, v_id, v_gecerli, (k ->> 'malzeme_id')::uuid, round((k ->> 'miktar')::numeric, 3)
    from jsonb_array_elements(p_kalemler) k;
  if not exists (select 1 from tarif_surumleri where urun_id = v_id and baslangic > v_gecerli) then
    delete from tarif_kalemleri where urun_id = v_id;
    insert into tarif_kalemleri (urun_id, malzeme_id, miktar)
      select v_id, (k ->> 'malzeme_id')::uuid, round((k ->> 'miktar')::numeric, 3) from jsonb_array_elements(p_kalemler) k;
  end if;
  return v_id;
end $$;

-- Eski çağrı (3 parametre) bugünden geçerli sürüm yazar.
create or replace function public.urun_kaydet(p_id uuid, p_ad text, p_kalemler jsonb)
returns uuid language sql security definer set search_path = public as $$
  select public.urun_kaydet(p_id, p_ad, p_kalemler, null::date)
$$;

-- ================================ 2-3. POS satırları ================================
create table if not exists public.satis_satirlari (
  id         bigint generated always as identity primary key,
  mekan_id   uuid not null references public.mekanlar(id) on delete cascade,
  belge_id   uuid references public.belgeler(id),
  anahtar    text not null,
  grup       text not null,                         -- iptalin düştüğü satış grubu (fiş / saat / gün + ürün)
  fis_no     text,
  zaman      timestamp,                              -- kasadaki yerel saat (varsa)
  tarih      date not null,
  ad         text not null,                          -- kasadaki ürün adı
  ad_anahtar text not null,
  urun_id    uuid,                                   -- null: menüde takip edilmeyen ürün
  adet       int not null check (adet between 1 and 100000),
  tutar      numeric(14,2),
  tur        text not null check (tur in ('satis', 'iptal', 'iade')),
  giris_id   uuid,                                   -- o günün satış girişi
  olusturma  timestamptz not null default now(),
  unique (mekan_id, anahtar),
  foreign key (urun_id, mekan_id) references public.urunler(id, mekan_id)
);
create index if not exists satis_satirlari_gun_idx on public.satis_satirlari(mekan_id, tarih);
alter table public.satis_satirlari enable row level security;
drop policy if exists satis_satiri_gor on public.satis_satirlari;
create policy satis_satiri_gor on public.satis_satirlari for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
revoke all on public.satis_satirlari from anon, authenticated;
grant select on public.satis_satirlari to authenticated;

-- Bir günün satış tüketimini satırlardan yeniden kurar (aynı girdi → aynı sonuç; kaç kez çağrılırsa çağrılsın).
create or replace function public.satis_gunu_yenile(p_mekan uuid, p_tarih date, p_giren uuid, p_giren_ad text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_g uuid;
begin
  select id into v_g from girisler
    where mekan_id = p_mekan and tur = 'satis' and tarih = p_tarih and iptal_zamani is null order by olusturma limit 1;
  if v_g is null then
    insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad)
      values (p_mekan, 'satis', p_tarih, 'Satış raporu', p_giren, coalesce(p_giren_ad, '?')) returning id into v_g;
  end if;
  update satis_satirlari set giris_id = v_g where mekan_id = p_mekan and tarih = p_tarih and giris_id is distinct from v_g;
  delete from malzeme_hareketleri where giris_id = v_g;
  delete from giris_kalemleri where giris_id = v_g;
  insert into giris_kalemleri (giris_id, mekan_id, urun_id, miktar)
    select v_g, p_mekan, urun_id, sum(net) from (
      select urun_id, greatest(0, coalesce(sum(adet) filter (where tur = 'satis'), 0)
                                 - coalesce(sum(adet) filter (where tur = 'iptal'), 0)) net
      from satis_satirlari where mekan_id = p_mekan and tarih = p_tarih and urun_id is not null and tur in ('satis', 'iptal')
      group by urun_id, grup) x
    group by urun_id having sum(net) > 0;
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    select v_g, p_mekan, t.malzeme_id, sum(t.miktar * gk.miktar)
    from giris_kalemleri gk cross join lateral tarif_gecerli(gk.urun_id, p_tarih) t
    where gk.giris_id = v_g
    group by t.malzeme_id;
  return v_g;
end $$;

-- p_satirlar: [{"tarih":"2026-10-03","zaman":"2026-10-03 14:22:05"|null,"fis_no":"A-1021"|null,"ad":"Latte",
--               "ad_anahtar":"latte","urun_id":"…"|null,"adet":2,"tutar":330.00|null,"tur":"satis"|"iptal"|"iade"}]
-- p_eslesmeler: [{"ad":"latte buyuk","urun_id":"…"|null}]  (patronun seçtikleri; hatırlanır)
-- Dönüş: eklenen / mükerrer (atlanan) satır sayısı, etkilenen günler, tarifsiz ürünler.
drop function if exists public.satis_raporu_isle(uuid, date, jsonb, jsonb);
create or replace function public.satis_raporu_isle(p_belge uuid, p_satirlar jsonb, p_eslesmeler jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b belgeler;
  k jsonb;
  v_kurulum boolean := kurulumcu_muyum();
  v_ad_k text; v_urun uuid; v_tarih date; v_zaman timestamp; v_fis text; v_tur text; v_adet int; v_tutar numeric;
  v_anahtar text; v_grup text; v_ad text;
  v_eklenen int := 0; v_mukerrer int := 0;
  v_gunler date[] := '{}';
  v_gun date;
  v_giren_ad text := coalesce((select ad from uyeler where user_id = auth.uid()), 'Kurulum');
begin
  select * into b from belgeler where id = p_belge for update;
  if not found or b.tur <> 'satis_raporu' or (not v_kurulum and b.mekan_id is distinct from benim_mekanim()) then
    raise exception 'Satış raporu bulunamadı.';
  end if;
  if not v_kurulum and not patron_muyum() then raise exception 'Satış raporunu yalnız patron işleyebilir.'; end if;
  if b.iptal_zamani is not null then raise exception 'Bu rapor iptal edilmiş.'; end if;
  if b.durum <> 'bekliyor' then raise exception 'Bu rapor zaten işlenmiş.'; end if;
  if jsonb_typeof(p_satirlar) is distinct from 'array' or jsonb_array_length(p_satirlar) = 0 then
    raise exception 'Raporda satış satırı yok.';
  end if;
  if jsonb_array_length(p_satirlar) > 20000 then raise exception 'Bir raporda en fazla 20.000 satır olabilir.'; end if;
  if p_eslesmeler is not null and jsonb_typeof(p_eslesmeler) is distinct from 'array' then raise exception 'Geçersiz eşleşme.'; end if;

  for k in select value from jsonb_array_elements(p_satirlar) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    begin v_tarih := (k ->> 'tarih')::date; exception when others then v_tarih := null; end;
    if v_tarih is null or v_tarih > bugun() or v_tarih < bugun() - 366 then
      raise exception 'Satırlardan birinin tarihi geçersiz (bugünden ileri ya da bir yıldan eski olamaz).';
    end if;
    begin v_zaman := nullif(k ->> 'zaman', '')::timestamp; exception when others then v_zaman := null; end;
    if v_zaman is not null and v_zaman::date <> v_tarih then raise exception 'Satırlardan birinin saati ile tarihi uyuşmuyor.'; end if;
    v_fis := nullif(left(trim(coalesce(k ->> 'fis_no', '')), 60), '');
    v_ad := left(trim(coalesce(k ->> 'ad', '')), 200);
    v_ad_k := left(lower(trim(coalesce(k ->> 'ad_anahtar', ''))), 200);
    if v_ad = '' or v_ad_k = '' then raise exception 'Satırlardan birinin ürün adı boş.'; end if;
    v_tur := coalesce(k ->> 'tur', 'satis');
    if v_tur not in ('satis', 'iptal', 'iade') then raise exception 'Geçersiz satır türü.'; end if;
    v_adet := case when jsonb_typeof(k -> 'adet') = 'number' and (k ->> 'adet')::numeric = trunc((k ->> 'adet')::numeric)
                   and (k ->> 'adet')::numeric between 1 and 100000 then (k ->> 'adet')::int end;
    if v_adet is null then raise exception 'Adetler 1 ile 100.000 arasında tam sayı olmalı (%).', v_ad; end if;
    v_tutar := case when jsonb_typeof(k -> 'tutar') = 'number' then round((k ->> 'tutar')::numeric, 2) end;
    v_urun := null;
    if k ->> 'urun_id' is not null then
      select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = b.mekan_id;
      if v_urun is null then raise exception 'Satırlarda bu mekana ait olmayan bir ürün var.'; end if;
    end if;
    v_grup := case when v_fis is not null then 'F|' || v_fis
                   when v_zaman is not null then 'Z|' || to_char(v_zaman, 'YYYY-MM-DD HH24:MI:SS')
                   else 'T|' || v_tarih end || '|' || v_ad_k;
    v_anahtar := case when v_fis is not null then v_grup || '|' || v_tur
                      else v_grup || '|' || v_adet || '|' || coalesce(v_tutar::text, '') || '|' || v_tur end;
    insert into satis_satirlari (mekan_id, belge_id, anahtar, grup, fis_no, zaman, tarih, ad, ad_anahtar, urun_id, adet, tutar, tur)
      values (b.mekan_id, b.id, v_anahtar, v_grup, v_fis, v_zaman, v_tarih, v_ad, v_ad_k, v_urun, v_adet, v_tutar, v_tur)
      on conflict (mekan_id, anahtar) do nothing;
    if found then
      v_eklenen := v_eklenen + 1;
      if not v_tarih = any(v_gunler) then v_gunler := v_gunler || v_tarih; end if;
    else
      v_mukerrer := v_mukerrer + 1;
    end if;
  end loop;

  foreach v_gun in array v_gunler loop
    perform satis_gunu_yenile(b.mekan_id, v_gun, auth.uid(), v_giren_ad);
  end loop;

  for k in select value from jsonb_array_elements(coalesce(p_eslesmeler, '[]')) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz eşleşme.'; end if;
    v_ad_k := left(lower(trim(coalesce(k ->> 'ad', ''))), 200);
    if v_ad_k = '' then raise exception 'Geçersiz eşleşme.'; end if;
    v_urun := null;
    if k ->> 'urun_id' is not null then
      select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = b.mekan_id;
      if v_urun is null then raise exception 'Eşleşmede bu mekana ait olmayan bir ürün var.'; end if;
    end if;
    insert into satis_eslesmeleri (mekan_id, ad_anahtar, urun_id) values (b.mekan_id, v_ad_k, v_urun)
      on conflict (mekan_id, ad_anahtar) do update set urun_id = excluded.urun_id, guncelleme = now();
  end loop;

  update belgeler set durum = 'tamam' where id = p_belge;
  return jsonb_build_object('eklenen', v_eklenen, 'mukerrer', v_mukerrer,
    'gunler', (select coalesce(jsonb_agg(d order by d), '[]') from unnest(v_gunler) d),
    'tarifsiz', coalesce((select jsonb_agg(distinct u.ad) from satis_satirlari s join urunler u on u.id = s.urun_id
                          where s.belge_id = p_belge and s.tur = 'satis'
                            and not exists (select 1 from tarif_surumleri t where t.urun_id = s.urun_id)), '[]'));
end $$;

-- Kurulum (fotoğraf / PDF raporu elle okunur): ürün adetleri tek güne yazılır, aynı yoldan geçer.
create or replace function public.kurulum_satis_raporu_isle(p_belge uuid, p_tarih date, p_kalemler jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_mekan uuid;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir ürünün adedini yaz.';
  end if;
  select mekan_id into v_mekan from belgeler where id = p_belge;
  perform satis_raporu_isle(p_belge, (
    select jsonb_agg(jsonb_build_object('tarih', p_tarih, 'ad', u.ad, 'ad_anahtar', lower(u.ad), 'urun_id', u.id,
                                        'adet', k -> 'miktar', 'tur', 'satis'))
    from jsonb_array_elements(p_kalemler) k left join urunler u on u.id::text = k ->> 'urun_id' and u.mekan_id = v_mekan), '[]');
  return (select id from girisler where mekan_id = v_mekan and tur = 'satis' and tarih = p_tarih and iptal_zamani is null
          order by olusturma limit 1);
end $$;

-- Satış günü iptal edilirse satırları da silinir: aynı rapor düzeltilip yeniden yüklenebilsin.
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
  update belgeler set iptal_eden = auth.uid(), iptal_eden_ad = v_ad, iptal_zamani = now()
    where giris_id = p_id and mekan_id = g.mekan_id and iptal_zamani is null;
  if g.tur = 'satis' then delete from satis_satirlari where giris_id = p_id; end if;
  if g.tur = 'fatura' then
    perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = p_id and malzeme_id is not null;
  end if;
end $$;

-- ================================ 4-5. Teslim tarihi ve sayım düzeltme ================================
alter table public.islem_gecmisi drop constraint if exists islem_gecmisi_tur_check;
alter table public.islem_gecmisi add constraint islem_gecmisi_tur_check
  check (tur in ('giris', 'giris_iptal', 'belge_iptal', 'mal_kabul', 'teslimat_farki', 'fark_cozuldu', 'fiyat_onay',
                 'teslim_tarihi', 'sayim_duzelt'));

create or replace function public.fatura_teslim_tarihi(p_giris uuid, p_tarih date) returns void
language plpgsql security definer set search_path = public as $$
declare g girisler;
begin
  if not patron_muyum() then raise exception 'Teslim tarihini yalnız patron düzeltebilir.'; end if;
  select * into g from girisler where id = p_giris and mekan_id = benim_mekanim() for update;
  if not found or g.tur <> 'fatura' then raise exception 'Fatura bulunamadı.'; end if;
  if g.iptal_zamani is not null then raise exception 'Bu giriş iptal edilmiş.'; end if;
  if p_tarih is null or p_tarih > bugun() or p_tarih < bugun() - 366 then raise exception 'Teslim tarihi geçersiz.'; end if;
  if p_tarih = g.tarih then return; end if;
  update girisler set tarih = p_tarih where id = p_giris;
  update fiyat_gecmisi set tarih = p_tarih where giris_id = p_giris;
  perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = p_giris and malzeme_id is not null;
  perform islem_yaz(g.mekan_id, 'teslim_tarihi', g.id, null,
    jsonb_build_object('eski', g.tarih, 'yeni', p_tarih, 'tedarikci', g.aciklama));
end $$;

create or replace function public.sayim_duzelt(p_giris uuid, p_malzeme uuid, p_miktar numeric, p_not text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  g girisler;
  v_eski numeric;
  m malzemeler;
begin
  if not patron_muyum() then raise exception 'Sayımı yalnız patron düzeltebilir.'; end if;
  select * into g from girisler where id = p_giris and mekan_id = benim_mekanim() for update;
  if not found or g.tur <> 'sayim' then raise exception 'Sayım bulunamadı.'; end if;
  if g.iptal_zamani is not null then raise exception 'Bu sayım iptal edilmiş.'; end if;
  if p_miktar is null or p_miktar < 0 or p_miktar >= 10000000000 then raise exception 'Miktar 0 ya da daha büyük olmalı.'; end if;
  select miktar into v_eski from malzeme_hareketleri where giris_id = p_giris and malzeme_id = p_malzeme for update;
  if not found then raise exception 'Bu malzeme bu sayımda yok.'; end if;
  select * into m from malzemeler where id = p_malzeme;
  update malzeme_hareketleri set miktar = round(p_miktar, 3) where giris_id = p_giris and malzeme_id = p_malzeme;
  update giris_kalemleri set miktar = round(p_miktar, 3) where giris_id = p_giris and malzeme_id = p_malzeme;
  perform islem_yaz(g.mekan_id, 'sayim_duzelt', g.id, null, jsonb_build_object('malzeme', m.ad, 'birim', m.birim,
    'eski', v_eski, 'yeni', round(p_miktar, 3), 'sayim_tarihi', g.tarih, 'not', nullif(left(trim(coalesce(p_not, '')), 200), '')));
end $$;

-- ================================ 6. Ağırlıklı ortalama maliyet ================================
-- TL / stok birimi (g, ml, adet). Son 90 günün doğrulanmış fatura kalemleri (iptal ve "fiyat kontrol" hariç);
-- yoksa malzemenin kayıtlı (onaylı) fiyatı. Tutar, sayılan miktara orantılıdır (eksik teslimatta da doğru birim maliyet).
create or replace function public.malzeme_birim_maliyet(p_malzeme uuid, p_bitis date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sum(k.tutar) / nullif(sum(k.miktar), 0)
     from giris_kalemleri k join girisler g on g.id = k.giris_id
     where k.malzeme_id = p_malzeme and g.tur = 'fatura' and g.iptal_zamani is null
       and g.tarih <= p_bitis and g.tarih > p_bitis - 90
       and k.tutar > 0 and k.miktar > 0 and not ('fiyat_kontrol' = any(coalesce(k.uyarilar, '{}')))),
    (select fiyat / (case birim when 'adet' then 1 else 1000 end) from malzemeler where id = p_malzeme and fiyat > 0))
$$;

-- ================================ 7. Reçetesiz satış ================================
-- Son 30 günde satılıp stoktan DÜŞÜLMEYEN ürünler: menüde karşılığı olmayan kasa ürünleri (ör. takip edilmeyen tatlı)
-- ve reçetesi olmayan menü ürünleri. Sessizce sıfır sayılmaz: patron ve barista ekranında görünür.
create or replace function public.tarifsiz_satislar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('urun', ad, 'adet', adet, 'menude', menude) order by adet desc), '[]')
  from (select coalesce(u.ad, min(s.ad)) ad, sum(s.adet) adet, s.urun_id is not null menude
        from satis_satirlari s left join urunler u on u.id = s.urun_id
        where s.mekan_id = benim_mekanim() and s.tur = 'satis' and s.tarih > bugun() - 30
          and (s.urun_id is null or not exists (select 1 from tarif_surumleri t where t.urun_id = s.urun_id))
        group by s.urun_id, u.ad, case when s.urun_id is null then s.ad_anahtar end) x
  where benim_mekanim() is not null
$$;

-- ================================ 6+8. Stok farkı ================================
-- Seçilen sayımın günü bitiş. Geniş sayımda (2+ malzeme) her malzemenin başlangıcı, bir önceki GENİŞ sayımın günündeki
-- (o gün ya da öncesindeki en yeni) sayımıdır: arada yapılan günlük süt sayımları haftalık süt açığını bölmez.
-- Dar sayımda (tek malzeme, ör. günlük süt) başlangıç o malzemenin bir önceki sayımıdır.
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
    select distinct on (malzeme_id) malzeme_id, miktar, tarih from sayimlar
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
      and g.tarih > ilk.tarih and g.tarih <= s2.tarih
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
      v_uyari := v_uyari || 'Bu dönemde hiç satış raporu yüklenmemiş: satılanlar kayıp gibi görünüyor. Girişler''den satış raporunu yükle.'::text;
    end if;
    select string_agg(format('%s (%s adet)', ad, adet), ', ' order by adet desc) into v_metin
      from (select coalesce(u.ad, min(s.ad)) ad, sum(s.adet) adet
            from satis_satirlari s left join urunler u on u.id = s.urun_id
            where s.mekan_id = v_mekan and s.tur = 'satis' and s.tarih > v_baslangic and s.tarih <= s2.tarih
              and (s.urun_id is null or not exists (select 1 from tarif_surumleri t where t.urun_id = s.urun_id))
            group by s.urun_id, u.ad, case when s.urun_id is null then s.ad_anahtar end) x;
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

-- Haftalık trend yalnız geniş sayımlarla (günlük süt sayımları haftalık trende dönem olarak girmez).
create or replace function public.acik_trendi(p_adet int default 8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  s record;
  r jsonb;
  v_sonuc jsonb := '[]';
  v_genis_var boolean;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Açık trendini yalnızca patron görebilir.'; end if;
  v_genis_var := exists (select 1 from girisler g where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
                          and (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2);
  for s in
    select id from (
      select distinct on (g.tarih) g.id, g.tarih from girisler g
      where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
        and (not v_genis_var or (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2)
      order by g.tarih desc, g.olusturma desc) x
    order by tarih desc limit least(greatest(coalesce(p_adet, 8), 1), 26)
  loop
    r := stok_farki(s.id);
    continue when r ->> 'baslangic' is null;
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
  return v_sonuc;
end $$;

-- Anlık stok: değer ağırlıklı ortalama maliyetle; son sayım tarihi her malzemede.
create or replace function public.stok_durumu() returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
      select m.id, m.ad, m.birim, malzeme_birim_maliyet(m.id, v_bugun) maliyet, s.tarih sayim_tarih, s.miktar sayilan,
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
             'malzeme_id', id, 'ad', ad, 'birim', birim,
             'fiyat', round(maliyet * (case birim when 'adet' then 1 else 1000 end), 2),
             'sayim_tarih', sayim_tarih, 'sayim_gun_once', v_bugun - sayim_tarih, 'sayilan', sayilan,
             'gelen', gelen, 'satis', satis, 'fire', fire,
             'simdi', simdi,
             'deger_tl', case when simdi is not null and maliyet > 0 then round(greatest(simdi, 0) * maliyet, 2) end,
             'gunluk', round(gunluk, 3),
             'yeter_gun', case when simdi is not null and gunluk > 0 then floor(greatest(simdi, 0) / gunluk) end)
           order by (simdi is null), (case when gunluk > 0 then greatest(simdi, 0) / gunluk end) nulls last, ad)
    from satir), '[]'::jsonb));
end $$;

-- Barista ekranı: son sayım + reçetesiz satış uyarısı.
create or replace function public.barista_durumu() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bugun', bugun(),
    'son_sayim', (select max(tarih) from girisler where mekan_id = benim_mekanim() and tur = 'sayim' and iptal_zamani is null),
    'tarifsiz', tarifsiz_satislar())
  where benim_mekanim() is not null
$$;

-- ---------- Yetkiler ----------
revoke all on function public.tarif_gecerli(uuid, date), public.satis_gunu_yenile(uuid, date, uuid, text)
  from public, anon, authenticated;
revoke all on function public.urun_kaydet(uuid, text, jsonb, date), public.urun_kaydet(uuid, text, jsonb),
  public.satis_raporu_isle(uuid, jsonb, jsonb), public.kurulum_satis_raporu_isle(uuid, date, jsonb), public.giris_iptal(uuid),
  public.fatura_teslim_tarihi(uuid, date), public.sayim_duzelt(uuid, uuid, numeric, text),
  public.malzeme_birim_maliyet(uuid, date), public.tarifsiz_satislar(), public.stok_farki(uuid), public.acik_trendi(int),
  public.stok_durumu(), public.barista_durumu() from public, anon;
grant execute on function public.urun_kaydet(uuid, text, jsonb, date), public.urun_kaydet(uuid, text, jsonb),
  public.satis_raporu_isle(uuid, jsonb, jsonb), public.kurulum_satis_raporu_isle(uuid, date, jsonb), public.giris_iptal(uuid),
  public.fatura_teslim_tarihi(uuid, date), public.sayim_duzelt(uuid, uuid, numeric, text),
  public.tarifsiz_satislar(), public.stok_farki(uuid), public.acik_trendi(int), public.stok_durumu(), public.barista_durumu()
  to authenticated;
revoke all on function public.malzeme_birim_maliyet(uuid, date) from authenticated;
