-- 25: Satış yalnız kasa raporuyla girilir (elle adet yazmak kapandı).
--  * Patron, kasa programının verdiği raporu (XLSX / CSV / HTML-Excel) yükler; uygulama cihazda okur, patron eşleşmeyen
--    ürün adlarını bir kez seçer → satis_raporu_isle. Fotoğraf / PDF / eski .xls raporları kurulum kuyruğunda kalır.
--  * Kasa ürün adı → menü ürünü eşleşmesi mekan başına hatırlanır (satis_eslesmeleri); sonraki raporlarda sorulmaz.
--  * giris_kaydet / giris_kaydet_tek artık 'satis' kabul etmez. Eski satış kayıtları ve iptal aynen çalışır.
-- Ek (geri alınabilir): yeni tablo + yeni işlev; değişen işlevlerin eski hâli scripts/geri-al-25.sql'de.

-- ---------- Kasa adı → ürün hafızası ----------
create table if not exists public.satis_eslesmeleri (
  mekan_id   uuid not null references public.mekanlar(id) on delete cascade,
  ad_anahtar text not null check (length(ad_anahtar) between 1 and 200),
  urun_id    uuid,                                   -- null: "tarifi yok, stoktan düşme" (su, hazır kek…)
  guncelleme timestamptz not null default now(),
  primary key (mekan_id, ad_anahtar),
  foreign key (urun_id) references public.urunler(id) on delete cascade
);
alter table public.satis_eslesmeleri enable row level security;
drop policy if exists satis_eslesme_gor on public.satis_eslesmeleri;
create policy satis_eslesme_gor on public.satis_eslesmeleri for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
revoke all on public.satis_eslesmeleri from anon, authenticated;
grant select on public.satis_eslesmeleri to authenticated;

-- Eski Excel (.xls) raporları da yüklenebilsin (kurulum işler).
update storage.buckets set allowed_mime_types = array(
  select distinct mime from unnest(allowed_mime_types || array['application/vnd.ms-excel', 'text/html']) as mime
) where id = 'fatura-belgeleri' and allowed_mime_types is not null;

-- ---------- Elle satış kapandı ----------
create or replace function public.giris_kaydet(p_tur text, p_tarih date, p_aciklama text, p_kalemler jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if p_tur = 'fatura' then
    raise exception 'Fatura ekranı güncellendi. Sayfayı yenileyip tekrar dene.';
  end if;
  if p_tur = 'satis' then
    raise exception 'Satış elle girilmez. Kasa programının satış raporunu yükle (Girişler → Satış raporu yükle).';
  end if;
  return giris_kaydet_v1(p_tur, p_tarih, p_aciklama, p_kalemler);
end $$;

-- ---------- Rapordan satış: patron (kendi mekanı) ya da kurulum ----------
-- p_kalemler: [{"urun_id": "...", "miktar": 48}, ...]   (raporun ürün adetleri, eşleşmiş)
-- p_eslesmeler: [{"ad": "latte (b)", "urun_id": "..." | null}, ...]   (patronun seçtikleri; hatırlanır)
create or replace function public.satis_raporu_isle(p_belge uuid, p_tarih date, p_kalemler jsonb, p_eslesmeler jsonb default '[]')
returns uuid language plpgsql security definer set search_path = public as $$
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
end $$;

-- Kurulumun eski işlevi aynı yolu kullanır (tek gövde).
create or replace function public.kurulum_satis_raporu_isle(p_belge uuid, p_tarih date, p_kalemler jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return satis_raporu_isle(p_belge, p_tarih, p_kalemler, '[]');
end $$;

revoke all on function public.satis_raporu_isle(uuid, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.satis_raporu_isle(uuid, date, jsonb, jsonb) to authenticated;
revoke all on function public.giris_kaydet(text, date, text, jsonb), public.kurulum_satis_raporu_isle(uuid, date, jsonb)
  from public, anon;
grant execute on function public.giris_kaydet(text, date, text, jsonb), public.kurulum_satis_raporu_isle(uuid, date, jsonb)
  to authenticated;
