-- Patron ekranları: şu anki stok ve haftalık açık trendi. Yalnız okuma yapar, veri değiştirmez.
-- Yalnız dosya olarak hazırlandı; canlıya uygulanmadı. 12 ve 13'ten sonra çalıştırılır (stok_farki'yi kullanır).
-- Geri almak için: drop function public.stok_durumu(); drop function public.acik_trendi(int);

-- Şu an elde ne var: her aktif malzeme için son sayım + o günden SONRA gelen − satılan (tarifle) − fire.
-- Sayım gün sonu kabul edilir (stok_farki ile aynı kural): sayım günündeki hareketler sayıma dahildir.
-- Günlük kullanım: son 28 gündeki satış + fire, mekanın ilk kaydından bu yana geçen gün sayısına (en çok 28) bölünür.
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
      select m.id, m.ad, m.birim, m.fiyat, s.tarih sayim_tarih, s.miktar sayilan,
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
             'malzeme_id', id, 'ad', ad, 'birim', birim, 'fiyat', fiyat,
             'sayim_tarih', sayim_tarih, 'sayilan', sayilan, 'gelen', gelen, 'satis', satis, 'fire', fire,
             'simdi', simdi,
             'deger_tl', case when simdi is not null and fiyat > 0
                              then round(greatest(simdi, 0) * fiyat / (case birim when 'adet' then 1 else 1000 end), 2) end,
             'gunluk', round(gunluk, 3),
             'yeter_gun', case when simdi is not null and gunluk > 0 then floor(greatest(simdi, 0) / gunluk) end)
           order by (simdi is null), (case when gunluk > 0 then greatest(simdi, 0) / gunluk end) nulls last, ad)
    from satir), '[]'::jsonb));
end $$;

-- Son N sayım dönemi (her gün için o günün en son sayımı) için açık/fazla TL ve en çok açık veren 3 malzeme.
-- Hesap stok_farki'nin kendisidir; burada yalnız dönemler toplanır (rapor ile özet hep aynı rakamı gösterir).
create or replace function public.acik_trendi(p_adet int default 8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  s record;
  r jsonb;
  v_sonuc jsonb := '[]';
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Açık trendini yalnızca patron görebilir.'; end if;
  for s in
    select id from (
      select distinct on (tarih) id, tarih from girisler
      where mekan_id = v_mekan and tur = 'sayim' and iptal_zamani is null
      order by tarih desc, olusturma desc) x
    order by tarih desc limit least(greatest(coalesce(p_adet, 8), 1), 26)
  loop
    r := stok_farki(s.id);
    continue when r ->> 'baslangic' is null;        -- ilk sayım: karşılaştıracak önceki sayım yok
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
  return v_sonuc;   -- en yeni dönem başta
end $$;

revoke all on function public.stok_durumu(), public.acik_trendi(int) from public, anon, authenticated;
grant execute on function public.stok_durumu(), public.acik_trendi(int) to authenticated;
