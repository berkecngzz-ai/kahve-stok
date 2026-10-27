-- 34_pasif_stok.sql: pasife alınan malzemenin eldeki stoğu kaybolmaz.
-- Sorun (kabul testi 2026-10-28): malzeme pasife alınınca (ör. badem sütü menüden kalktı) stok_durumu onu tamamen
-- gizliyordu: rafta duran 8 L ve değeri "Elde olan malın değeri"nden sessizce düşüyordu.
-- Şimdi: pasif malzeme, hesaplanan stoğu sıfırdan büyükse listede kalır ('aktif': false); stoğu biten pasif görünmez.
begin;

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
      select distinct on (h.malzeme_id) h.malzeme_id, g.tarih, g.olusturma, h.miktar,
             not exists (select 1 from girisler y join malzeme_hareketleri yh on yh.giris_id = y.id
                         where y.mekan_id = v_mekan and y.tur = 'sayim' and y.iptal_zamani is null and yh.malzeme_id = h.malzeme_id
                           and (y.tarih < g.tarih or (y.tarih = g.tarih and y.olusturma < g.olusturma))) acilis
      from girisler g join malzeme_hareketleri h on h.giris_id = g.id
      where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
      order by h.malzeme_id, g.tarih desc, g.olusturma desc
    ),
    hareket as (
      select h.malzeme_id,
             coalesce(sum(h.miktar) filter (where g.tur = 'fatura' and sayimdan_sonra(g.tarih, g.tur, g.olusturma, s.tarih, s.olusturma, s.acilis)), 0) gelen,
             coalesce(sum(h.miktar) filter (where g.tur = 'satis' and sayimdan_sonra(g.tarih, g.tur, g.olusturma, s.tarih, s.olusturma, s.acilis)), 0) satis,
             coalesce(sum(h.miktar) filter (where g.tur = 'fire' and sayimdan_sonra(g.tarih, g.tur, g.olusturma, s.tarih, s.olusturma, s.acilis)), 0) fire,
             coalesce(sum(h.miktar) filter (where g.tur in ('satis', 'fire') and g.tarih > v_bugun - 28), 0) kullanim_28
      from malzeme_hareketleri h
      join girisler g on g.id = h.giris_id
      left join son_sayim s on s.malzeme_id = h.malzeme_id
      where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tur in ('fatura', 'satis', 'fire')
      group by h.malzeme_id
    ),
    satir as (
      select m.id, m.ad, m.birim, m.aktif, malzeme_birim_maliyet(m.id, v_bugun) maliyet, s.tarih sayim_tarih, s.miktar sayilan,
             coalesce(hr.gelen, 0) gelen, coalesce(hr.satis, 0) satis, coalesce(hr.fire, 0) fire,
             case when s.malzeme_id is not null
                  then s.miktar + coalesce(hr.gelen, 0) - coalesce(hr.satis, 0) - coalesce(hr.fire, 0) end simdi,
             case when v_gun > 0 then coalesce(hr.kullanim_28, 0) / v_gun end gunluk
      from malzemeler m
      left join son_sayim s on s.malzeme_id = m.id
      left join hareket hr on hr.malzeme_id = m.id
      where m.mekan_id = v_mekan
    )
    select jsonb_agg(jsonb_build_object(
             'malzeme_id', id, 'ad', ad, 'birim', birim, 'aktif', aktif,
             'fiyat', round(maliyet * (case birim when 'adet' then 1 else 1000 end), 2),
             'sayim_tarih', sayim_tarih, 'sayim_gun_once', v_bugun - sayim_tarih, 'sayilan', sayilan,
             'gelen', gelen, 'satis', satis, 'fire', fire,
             'simdi', simdi,
             'deger_tl', case when simdi is not null and maliyet > 0 then round(greatest(simdi, 0) * maliyet, 2) end,
             'gunluk', round(gunluk, 3),
             'yeter_gun', case when simdi is not null and gunluk > 0 then floor(greatest(simdi, 0) / gunluk) end)
           order by (simdi is null), (case when gunluk > 0 then greatest(simdi, 0) / gunluk end) nulls last, ad)
    from satir where aktif or simdi > 0), '[]'::jsonb));
end $$;

revoke all on function public.stok_durumu() from public, anon;
grant execute on function public.stok_durumu() to authenticated;

commit;
