-- 39: Dönemin satış verisi eksik mi? acik_trendi'ye 'satis_gun' eklenir: dönemde (başlangıç sayımından sonraki gün →
-- bitiş sayımı günü dahil) satış raporu olan farklı gün sayısı. Satışı girilmemiş dönemde satılan her şey "fark"
-- görünür; ön yüz (patron-hesap.js: satisEksik) bu dönemde stok farkını değerlendirmez, "Satış raporu eksik" der.
-- Geri alma: scripts/geri-al-39.sql (sql/38'deki acik_trendi; ön yüz 'satis_gun' yoksa eski davranışa döner).

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
      'gun', (r ->> 'bitis')::date - (r ->> 'baslangic')::date,
      'satis_gun', (select count(distinct g.tarih) from girisler g
                    where g.mekan_id = v_mekan and g.tur = 'satis' and g.iptal_zamani is null
                      and g.tarih > (r ->> 'baslangic')::date and g.tarih <= (r ->> 'bitis')::date),
      'acik_tl', r -> 'toplam_acik_tl', 'fazla_tl', r -> 'toplam_fazla_tl',
      'kullanilan_tl', coalesce((
        select round(sum((coalesce((x ->> 'satis')::numeric, 0) + coalesce((x ->> 'fire')::numeric, 0))
                         * (x ->> 'fiyat')::numeric / (case x ->> 'birim' when 'adet' then 1 else 1000 end)), 2)
        from jsonb_array_elements(r -> 'satirlar') x
        where x ->> 'durum' = 'tamam' and (x ->> 'fiyat')::numeric > 0), 0),
      'uyarilar', r -> 'uyarilar',
      'en_cok_acik', coalesce((
        select jsonb_agg(x order by (x ->> 'fark_tl')::numeric) from (
          select x from jsonb_array_elements(r -> 'satirlar') x
          where x ->> 'durum' = 'tamam' and (x ->> 'fark_tl')::numeric < 0
          order by (x ->> 'fark_tl')::numeric limit 3) t), '[]'::jsonb));
  end loop;
  return v_sonuc;
end $$;

revoke all on function public.acik_trendi(int) from public, anon, authenticated;
grant execute on function public.acik_trendi(int) to authenticated;
