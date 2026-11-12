-- 36: e-İRSALİYE (fiyatsız sevk belgesi) ve sonradan gelen faturayla MAHSUP.
--
-- Sorun (gerçek belgelerle test, 2026-11-13): Sütaş ve Söylemezoğlu malı e-irsaliyeyle getiriyor; irsaliyede fiyat ve
-- toplam yok. Uygulama "faturanın en altındaki toplamı yaz" diyordu → barista takılıyordu, mal stoğa giremiyordu.
--
--  1) belge_kaydet 'irsaliye': true alır. Satırlarda fiyat yoktur (gönderilse de yok sayılır), toplam istenmez.
--     Mal stoğa girer; kalemin fiyatı yoktur (maliyet hesabına girmez, 'irsaliye' etiketi: patrona tutar görevi açılmaz). Mükerrer kontrolü: irsaliye no +
--     tedarikçi ve dosya özeti (ettn) — fiyat olmadığı için içerik izi kullanılmaz.
--  2) Aynı mal için FATURA sonra gelir (çoğu zaman ay sonunda, birkaç irsaliyeyi birden). Fatura kaydedilirken her stoklanan
--     satır, aynı malzemenin henüz faturalanmamış irsaliye miktarlarıyla eski→yeni MAHSUP edilir: mahsup edilen kısım
--     stoğa İKİNCİ KEZ eklenmez (mal irsaliyeyle zaten girdi); fatura kalemi tutarıyla birlikte kalır → birim maliyet doğru.
--     Eşleşme: önce aynı tedarikçi; başka tedarikçi (ör. "faturası X tarafından düzenlenecek") yalnız miktar BİREBİR
--     aynıysa. Pencere: irsaliye fatura tarihinden en fazla 62 gün önce, 7 gün sonra.
--  3) İptal: fatura iptal edilirse mahsubu düşer (irsaliye yeniden açık sayılır). Mahsup edilmiş irsaliye, faturası
--     iptal edilmeden iptal edilemez (stok eksik kalırdı).
-- Geri alma: scripts/geri-al-36.sql

alter table public.belgeler add column if not exists irsaliye boolean not null default false;

create table if not exists public.irsaliye_mahsuplari (
  id                bigint generated always as identity primary key,
  mekan_id          uuid not null references public.mekanlar(id) on delete cascade,
  fatura_satir_id   bigint not null references public.belge_satirlari(id) on delete cascade,
  irsaliye_satir_id bigint not null references public.belge_satirlari(id) on delete cascade,
  miktar            numeric(16,3) not null check (miktar > 0),
  olusturma         timestamptz not null default now(),
  unique (fatura_satir_id, irsaliye_satir_id)
);
create index if not exists irsaliye_mahsuplari_irsaliye_idx on public.irsaliye_mahsuplari(irsaliye_satir_id);
create index if not exists irsaliye_mahsuplari_mekan_idx on public.irsaliye_mahsuplari(mekan_id);
alter table public.irsaliye_mahsuplari enable row level security;
drop policy if exists irsaliye_mahsup_gor on public.irsaliye_mahsuplari;
create policy irsaliye_mahsup_gor on public.irsaliye_mahsuplari for select to authenticated
  using (mekan_id = public.benim_mekanim());
revoke all on public.irsaliye_mahsuplari from anon, authenticated;
grant select on public.irsaliye_mahsuplari to authenticated;

-- İrsaliye satırının henüz faturalanmamış (açık) miktarı, stok biriminde. İptal edilmiş faturaların mahsubu sayılmaz.
create or replace function public.irsaliye_acik_miktar(p_satir bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select s.stok_miktari - coalesce((
    select sum(m.miktar) from irsaliye_mahsuplari m
      join belge_satirlari fs on fs.id = m.fatura_satir_id
      join belgeler fb on fb.id = fs.belge_id
    where m.irsaliye_satir_id = s.id and fb.iptal_zamani is null), 0)
  from belge_satirlari s where s.id = p_satir
$$;

-- Fatura belgesinin stoklanan satırlarını açık irsaliyelerle mahsup eder. Döner: mahsup edilen satır sayısı.
create or replace function public.irsaliye_mahsup_et(p_belge uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  b belgeler;
  s belge_satirlari;
  i record;
  v_tarih date;
  v_kalan numeric;
  v_x numeric;
  v_toplam numeric;
  v_sayi int := 0;
begin
  select * into b from belgeler where id = p_belge;
  if not found or b.irsaliye or b.tur <> 'fatura' or b.giris_id is null then return 0; end if;
  v_tarih := coalesce(b.belge_tarihi, (select tarih from girisler where id = b.giris_id));
  for s in select * from belge_satirlari
           where belge_id = p_belge and durum = 'stokta' and malzeme_id is not null and stok_miktari > 0
           order by sira loop
    v_kalan := s.stok_miktari;
    -- (a) aynı tedarikçinin açık irsaliyeleri, eskiden yeniye
    for i in select x.id, irsaliye_acik_miktar(x.id) acik
             from belge_satirlari x join belgeler ib on ib.id = x.belge_id join girisler ig on ig.id = ib.giris_id
             where ib.mekan_id = b.mekan_id and ib.irsaliye and ib.iptal_zamani is null and ig.iptal_zamani is null
               and x.durum = 'stokta' and x.malzeme_id = s.malzeme_id
               and ib.tedarikci_anahtar = b.tedarikci_anahtar and b.tedarikci_anahtar <> ''
               and ig.tarih between v_tarih - 62 and v_tarih + 7
             order by ig.tarih, x.id
             for update of x loop
      exit when v_kalan <= 0;
      v_x := least(v_kalan, i.acik);
      if v_x > 0 then
        insert into irsaliye_mahsuplari (mekan_id, fatura_satir_id, irsaliye_satir_id, miktar)
          values (b.mekan_id, s.id, i.id, v_x);
        v_kalan := v_kalan - v_x;
      end if;
    end loop;
    -- (b) başka tedarikçi: yalnız tek irsaliye satırının açık miktarı faturadakiyle BİREBİR aynıysa
    if v_kalan = s.stok_miktari then
      select x.id into i
        from belge_satirlari x join belgeler ib on ib.id = x.belge_id join girisler ig on ig.id = ib.giris_id
        where ib.mekan_id = b.mekan_id and ib.irsaliye and ib.iptal_zamani is null and ig.iptal_zamani is null
          and x.durum = 'stokta' and x.malzeme_id = s.malzeme_id
          and ig.tarih between v_tarih - 62 and v_tarih + 7
          and irsaliye_acik_miktar(x.id) = s.stok_miktari
        order by ig.tarih, x.id limit 1;
      if found then
        insert into irsaliye_mahsuplari (mekan_id, fatura_satir_id, irsaliye_satir_id, miktar)
          values (b.mekan_id, s.id, i.id, s.stok_miktari);
        v_kalan := 0;
      end if;
    end if;
    v_toplam := s.stok_miktari - v_kalan;
    if v_toplam > 0 then
      -- Mal irsaliyeyle stoğa girdi: faturanın stok hareketinden düşülür (kalem tutarıyla kalır → maliyet doğru).
      update malzeme_hareketleri set miktar = greatest(0, miktar - v_toplam)
        where giris_id = b.giris_id and malzeme_id = s.malzeme_id;
      -- Girişler ekranında "irsaliyeyle girmişti" yazsın (patron iki kez girdi sanmasın)
      update giris_kalemleri set uyarilar = array_append(coalesce(uyarilar, '{}'), 'irsaliyede')
        where belge_satir_id = s.id and not ('irsaliyede' = any(coalesce(uyarilar, '{}')));
      v_sayi := v_sayi + 1;
    end if;
  end loop;
  return v_sayi;
end $$;

-- ---------- belge_kaydet: irsaliye + mahsup ----------
alter function public.belge_kaydet(jsonb) rename to belge_kaydet_v35;
create or replace function public.belge_kaydet(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_irs boolean := coalesce(case when jsonb_typeof(p -> 'irsaliye') = 'boolean' then (p ->> 'irsaliye')::boolean end, false);
  v_id uuid;
  v_satir bigint;
  v_mahsup int := 0;
  r jsonb;
begin
  if v_irs then
    if coalesce(p ->> 'tur', 'fatura') <> 'fatura' then raise exception 'Geçersiz belge türü.'; end if;
    -- Fiyat yok: satırlardaki tutarlar yok sayılır, toplam 0 (alt işlev toplam ister); aynı gün aynı tedarikçi
    -- "aynı olabilir" kontrolü toplam 0 olduğu için anlamsız → atlanır (irsaliye no + dosya özeti kontrolü sürer).
    p := p || jsonb_build_object('toplamlar', jsonb_build_object('genel', 0, 'indirim', 0), 'ayni_olabilir_onay', true,
      'satirlar', coalesce((select jsonb_agg(k - 'birim_fiyat' - 'tutar_haric' - 'tutar_dahil' - 'kdv_orani')
                            from jsonb_array_elements(case when jsonb_typeof(p -> 'satirlar') = 'array' then p -> 'satirlar' else '[]' end) k), '[]'));
  end if;
  r := belge_kaydet_v35(p);
  if coalesce((r ->> 'tekrar')::boolean, false) then return r; end if;
  v_id := (r ->> 'id')::uuid;
  if v_irs then
    update belgeler set irsaliye = true, genel_toplam = null, toplam_tutuyor = null where id = v_id;
    -- Toplam kontrolü irsaliyede yok: onaylanan satırlar stoğa girer, fiyatı kontrol bekler (fatura gelince).
    for v_satir in select id from belge_satirlari
                   where belge_id = v_id and durum = 'bekliyor' and bekleme_sebebi = 'toplam' order by sira loop
      update belge_satirlari set durum = 'stokta', bekleme_sebebi = null, fiyat_kontrol = true where id = v_satir;
      perform belge_satiri_stokla(v_satir);
    end loop;
    -- Fiyat faturayla gelecek: kalemler "tutar onayı bekliyor" görevine düşmez ('irsaliye' etiketi); girişte toplam yok.
    update giris_kalemleri set uyarilar = array_replace(uyarilar, 'fiyat_kontrol', 'irsaliye')
      where giris_id = (select giris_id from belgeler where id = v_id);
    update girisler set belge_genel_toplam = null, belge_kdv_haric_toplam = null, belge_kdv_toplam = null, belge_indirim = null
      where id = (select giris_id from belgeler where id = v_id);
    perform belge_durumu_yenile(v_id);
    return r || jsonb_build_object('irsaliye', true, 'durum', (select durum from belgeler where id = v_id),
      'stoklanan', (select count(*) from belge_satirlari where belge_id = v_id and durum = 'stokta'),
      'bekleyen', (select count(*) from belge_satirlari where belge_id = v_id and durum = 'bekliyor'));
  end if;
  v_mahsup := irsaliye_mahsup_et(v_id);
  return r || jsonb_build_object('irsaliye_mahsup', v_mahsup);
end $$;

-- ---------- İptal: mahsup edilmiş irsaliye, faturası iptal edilmeden iptal edilemez ----------
alter function public.giris_iptal(uuid) rename to giris_iptal_v26;
create or replace function public.giris_iptal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from belgeler ib join belge_satirlari x on x.belge_id = ib.id
               join irsaliye_mahsuplari m on m.irsaliye_satir_id = x.id
               join belge_satirlari fs on fs.id = m.fatura_satir_id join belgeler fb on fb.id = fs.belge_id
             where ib.giris_id = p_id and ib.mekan_id = benim_mekanim() and ib.irsaliye and fb.iptal_zamani is null) then
    raise exception 'Bu irsaliyedeki mal bir faturayla eşleşti. Önce o faturayı iptal et.';
  end if;
  perform giris_iptal_v26(p_id);
end $$;

alter function public.kaydi_geri_al(text, uuid) rename to kaydi_geri_al_v05;
create or replace function public.kaydi_geri_al(p_tur text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tur = 'belge' and exists (select 1 from belgeler ib join belge_satirlari x on x.belge_id = ib.id
               join irsaliye_mahsuplari m on m.irsaliye_satir_id = x.id
               join belge_satirlari fs on fs.id = m.fatura_satir_id join belgeler fb on fb.id = fs.belge_id
             where ib.id = p_id and ib.mekan_id = benim_mekanim() and ib.irsaliye and fb.iptal_zamani is null) then
    raise exception 'Bu irsaliyedeki mal bir faturayla eşleşti. Önce o faturayı iptal et.';
  end if;
  perform kaydi_geri_al_v05(p_tur, p_id);
end $$;

revoke all on function public.belge_kaydet_v35(jsonb), public.giris_iptal_v26(uuid), public.kaydi_geri_al_v05(text, uuid),
  public.irsaliye_mahsup_et(uuid), public.irsaliye_acik_miktar(bigint) from public, anon, authenticated;
revoke all on function public.belge_kaydet(jsonb), public.giris_iptal(uuid), public.kaydi_geri_al(text, uuid) from public, anon;
grant execute on function public.belge_kaydet(jsonb), public.giris_iptal(uuid), public.kaydi_geri_al(text, uuid) to authenticated;
