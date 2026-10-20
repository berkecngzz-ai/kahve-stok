-- Adım 4 / Parça 3: AI ile fatura okuma — okuma kayıtları, mekan başına günlük sınır, AI kararının sunucuda saklanması.
-- 05_belge_okuma_kurulum.sql'den SONRA çalıştırılır.
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
--
-- Akış: telefon fotoğrafı "fatura-oku" işlevine (Edge Function) gönderir → işlev ai_okuma_baslat ile hak alır
-- (günlük sınır burada) → OpenAI'ı çağırır → sonucu ai_okuma_bitir ile (yalnız sunucu yetkisiyle) yazar.
-- Belge kaydedilirken AI'nın "takip dışı" kararı TELEFONDAN DEĞİL bu kayıttan okunur.

alter table public.mekanlar
  add column ai_gunluk_sinir int not null default 20 check (ai_gunluk_sinir between 0 and 1000);

create table public.ai_okumalari (
  id           uuid primary key default gen_random_uuid(),
  mekan_id     uuid not null references public.mekanlar(id) on delete cascade,
  kullanici    uuid not null,
  olusturma    timestamptz not null default now(),
  model        text not null check (length(model) <= 60),
  durum        text not null default 'basladi' check (durum in ('basladi', 'tamam', 'hata')),
  hata         text check (length(hata) <= 500),
  sonuc        jsonb check (sonuc is null or pg_column_size(sonuc) < 200000),
  giris_token  int,
  cikis_token  int,
  maliyet_usd  numeric(12,6),
  sure_ms      int,
  kullanildi   boolean not null default false,       -- bir belgeye bağlandı mı (bir kez)
  unique (id, mekan_id)
);
create index ai_okumalari_mekan_gun_idx on public.ai_okumalari(mekan_id, olusturma desc);

alter table public.ai_okumalari enable row level security;
-- Patron kendi mekanının okumalarını (sayı, süre, maliyet) görür; barista görmez.
create policy ai_okuma_gor on public.ai_okumalari for select to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());
revoke all on public.ai_okumalari from anon, authenticated;
grant select on public.ai_okumalari to authenticated;

-- Okuma hakkı al: giriş yapmış ve mekana bağlı kullanıcı; mekanın bugünkü (Türkiye saati) okuma sayısı sınırın altında.
-- Edge Function bunu KULLANICININ oturumuyla çağırır (kim olduğu buradan anlaşılır).
create or replace function public.ai_okuma_baslat(p_model text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_sinir int;
  v_bugun int;
  v_id uuid;
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  if p_model is null or length(p_model) > 60 then raise exception 'Geçersiz model.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:' || v_mekan::text, 0));
  select ai_gunluk_sinir into v_sinir from mekanlar where id = v_mekan;
  select count(*) into v_bugun from ai_okumalari
    where mekan_id = v_mekan and (olusturma at time zone 'Europe/Istanbul')::date = bugun();
  if v_bugun >= v_sinir then
    raise exception 'GUNLUK_SINIR: Bugünkü fatura okuma sınırı doldu (%).', v_sinir;
  end if;
  insert into ai_okumalari (mekan_id, kullanici, model) values (v_mekan, auth.uid(), p_model) returning id into v_id;
  return v_id;
end $$;

-- Okumayı bitir: YALNIZCA sunucu (service_role) çağırabilir. Telefon AI sonucunu yazamaz/değiştiremez.
create or replace function public.ai_okuma_bitir(p_id uuid, p_durum text, p_sonuc jsonb, p_giris_token int,
                                                 p_cikis_token int, p_maliyet numeric, p_sure_ms int, p_hata text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_durum not in ('tamam', 'hata') then raise exception 'Geçersiz durum.'; end if;
  update ai_okumalari
    set durum = p_durum, sonuc = p_sonuc, giris_token = p_giris_token, cikis_token = p_cikis_token,
        maliyet_usd = p_maliyet, sure_ms = p_sure_ms, hata = left(p_hata, 500)
    where id = p_id and durum = 'basladi';
  if not found then raise exception 'Okuma bulunamadı.'; end if;
end $$;

-- Patron/barista: bugünkü kullanım (ekranda "bugün 3/20")
create or replace function public.ai_okuma_durumu() returns table (bugun int, sinir int)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from ai_okumalari a
          where a.mekan_id = benim_mekanim() and (a.olusturma at time zone 'Europe/Istanbul')::date = bugun()),
         (select ai_gunluk_sinir from mekanlar where id = benim_mekanim())
  where benim_mekanim() is not null
$$;

-- AI'nın "takip dışı" dediği satırlar ayrı işaretlenir (kurulum gözden geçirebilsin).
alter table public.belge_satirlari drop constraint belge_satirlari_cozen_check;
alter table public.belge_satirlari add constraint belge_satirlari_cozen_check
  check (cozen in ('otomatik', 'barista', 'kurulum', 'ai'));
alter table public.belgeler add column ai_okuma_id uuid;

-- ---------- belge_kaydet: AI okumasıyla gelen belgede "takip dışı" kararı sunucudaki AI sonucundan ----------
-- Telefon satırı "takip_disi" gönderdiğinde kabul şartı: defterde takip dışı kaydı VAR, ya da bu belgenin AI okumasında
-- AYNI satır (aynı sıra, aynı metin) için AI "takip_disi" demiş ve güveni ≥ 0,8. İkisi de yoksa satır kuyrukta bekler.
create or replace function public.ai_takip_disi_mi(p_okuma uuid, p_mekan uuid, p_sira int, p_metin_anahtar text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ai_okumalari a,
         jsonb_array_elements(a.sonuc -> 'satirlar') with ordinality as s(satir, sira)
    where a.id = p_okuma and a.mekan_id = p_mekan and a.durum = 'tamam'
      and s.sira = p_sira
      and metin_anahtari(s.satir ->> 'metin') = p_metin_anahtar
      and s.satir -> 'eslesme' ->> 'karar' = 'takip_disi'
      and coalesce((s.satir -> 'eslesme' ->> 'guven')::numeric, 0) >= 0.8)
$$;

-- belge_kaydet'in takip dışı dalını genişletmek için: 05'teki işlev yeniden tanımlanır (yalnız ilgili kısımlar değişti).
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
              case when v_durum = 'stokta' then 'bekliyor' else v_durum end,
              case when v_durum = 'stokta' then 'toplam' else v_sebep end,
              v_aday, v_mal, case when v_mal is not null then v_carpan end, v_stok,
              v_cozen, case when v_cozen is not null then now() end);
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
  select count(*) filter (where durum = 'stokta'), count(*) filter (where durum = 'bekliyor'),
         count(*) filter (where durum = 'takip_disi')
    into v_say_stok, v_say_bekle, v_say_disi from belge_satirlari where belge_id = v_id;
  return jsonb_build_object('id', v_id, 'durum', (select durum from belgeler where id = v_id), 'tekrar', false,
    'toplam_tutuyor', v_tutuyor, 'stoklanan', v_say_stok, 'bekleyen', v_say_bekle, 'takip_disi', v_say_disi);
end $$;

alter table public.belgeler drop constraint belgeler_kaynak_check;
alter table public.belgeler add constraint belgeler_kaynak_check check (kaynak in ('xml', 'pdf', 'ocr', 'elle', 'dosya', 'ai'));

-- ---------- Kurulum: AI'nın "takip dışı" dedikleri (gözden geçirme) ----------
create or replace function public.kurulum_ai_takip_disi() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'mekan', k.ad, 'metin', s.metin, 'miktar', s.miktar, 'birim', s.birim,
                                        'tarih', b.olusturma, 'tedarikci', b.tedarikci) order by b.olusturma desc)
    from (select * from belge_satirlari where cozen = 'ai' and durum = 'takip_disi' order by id desc limit 100) s
    join belgeler b on b.id = s.belge_id and b.iptal_zamani is null
    join mekanlar k on k.id = s.mekan_id), '[]'::jsonb);
end $$;

-- Yanlış "takip dışı" kararını geri al: satır yeniden kuyruğa düşer (sonra malzemeye bağlanır).
create or replace function public.kurulum_takip_disi_geri_al(p_satir bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s belge_satirlari;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  select * into s from belge_satirlari where id = p_satir and durum = 'takip_disi' for update;
  if not found then raise exception 'Satır bulunamadı.'; end if;
  update belge_satirlari set durum = 'bekliyor', bekleme_sebebi = 'eslesme', cozen = null, cozum_zamani = null
    where id = p_satir;
  delete from eslestirme_defteri
    where mekan_id = s.mekan_id and metin_anahtar = s.metin_anahtar and sonuc = 'takip_disi';
  perform belge_durumu_yenile(s.belge_id);
end $$;

-- Kurulum: tüm mekanların AI kullanımı (son 30 gün)
create or replace function public.kurulum_ai_kullanim() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return coalesce((select jsonb_agg(x) from (
    select k.ad as mekan, a.model, count(*) as okuma, count(*) filter (where a.durum = 'hata') as hata,
           round(avg(a.sure_ms)) as ort_ms, sum(a.maliyet_usd) as maliyet_usd
    from ai_okumalari a join mekanlar k on k.id = a.mekan_id
    where a.olusturma > now() - interval '30 days'
    group by k.ad, a.model order by k.ad, a.model) x), '[]'::jsonb);
end $$;

-- ---------- Yetkiler ----------
revoke all on function public.ai_okuma_baslat(text), public.ai_okuma_bitir(uuid, text, jsonb, int, int, numeric, int, text),
  public.ai_okuma_durumu(), public.ai_takip_disi_mi(uuid, uuid, int, text), public.belge_kaydet(jsonb),
  public.kurulum_ai_takip_disi(), public.kurulum_takip_disi_geri_al(bigint), public.kurulum_ai_kullanim()
  from public, anon, authenticated;
grant execute on function public.ai_okuma_baslat(text), public.ai_okuma_durumu(), public.belge_kaydet(jsonb),
  public.kurulum_ai_takip_disi(), public.kurulum_takip_disi_geri_al(bigint), public.kurulum_ai_kullanim()
  to authenticated;
-- Okumayı bitirmek yalnızca sunucuya (Edge Function'ın gizli anahtarı) açık.
grant execute on function public.ai_okuma_bitir(uuid, text, jsonb, int, int, numeric, int, text) to service_role;
