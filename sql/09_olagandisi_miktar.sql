-- 09: Olağandışı satır kontrolü — miktar kuralı yalnız fiyatla doğrulanamayan satırda.
-- Neden: satırın birim fiyatı bilinen fiyata %30 içinde uyuyorsa miktar paradan doğrulanmıştır
-- (yanlış okunan miktar ya da yanlış paket çarpanı birim fiyatı bozar, fiyat kontrolüne takılır; satır tutarı
-- yanlış okunduysa toplam tutmaz). Bu durumda "geçmişin 3 katı" kuralı doğru büyük siparişleri gereksiz yere
-- kuyruğa atıyordu. Fiyat referansı yoksa ya da satırın tutarı/KDV'si yoksa miktar kuralı eskisi gibi uygulanır.
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
    return null;                                   -- fiyat tuttu: miktar paradan doğrulandı
  end if;
  select count(*), percentile_cont(0.5) within group (order by miktar) into v_sayi, v_medyan
    from (select gk.miktar from giris_kalemleri gk join girisler g on g.id = gk.giris_id
          where g.mekan_id = p_mekan and g.tur = 'fatura' and g.iptal_zamani is null
            and gk.malzeme_id = p_malzeme and not gk.stok_disi and gk.miktar > 0
          order by g.tarih desc, g.olusturma desc limit 10) x;
  if v_sayi >= 3 and v_medyan > 0 and (p_stok > v_medyan * 3 or p_stok < v_medyan / 3) then return 'miktar'; end if;
  return null;
end $$;
