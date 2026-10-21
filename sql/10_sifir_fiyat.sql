-- 10: Güncel fiyat seçiminde 0 TL (bilinmeyen) kayıt, gerçek bir fiyatın önüne geçmez.
-- Sorun: malzeme oluşturulurken fiyat_kaydi tetikleyicisi bugünün tarihiyle "elle 0,00" kaydı yazıyor. Güncel fiyat
-- "en yeni tarihli kayıt" olduğu için belge tarihi daha eski olan faturaların fiyatı hiç geçerli olmuyor, malzeme fiyatı
-- 0'da kalıyor. Sonuç: faturadan gelen satırlarda fiyat kontrolü hiç çalışmıyor (satir_olagandisi m.fiyat > 0 arar),
-- doğru miktarlar "geçmişin 3 katı" kuralıyla kuyruğa düşüyor.
-- Kural: önce sıfırdan büyük kayıtlar arasında en yenisi; hiç yoksa (ör. tek fatura iptal edildi) en yeni kayıt (0).
create or replace function public.fiyat_yenile(p_malzeme uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select fg.fiyat, fg.fiyat_haric, fg.kdv_orani into f
    from fiyat_gecmisi fg left join girisler g on g.id = fg.giris_id
    where fg.malzeme_id = p_malzeme and g.iptal_zamani is null
    order by (fg.fiyat > 0) desc, fg.tarih desc, fg.zaman desc, fg.id desc limit 1;
  if not found then return; end if;
  perform set_config('kahve.sistem', '1', true);
  update malzemeler set fiyat = f.fiyat, fiyat_haric = f.fiyat_haric, kdv_orani = f.kdv_orani
    where id = p_malzeme
      and (fiyat, fiyat_haric, kdv_orani) is distinct from (f.fiyat, f.fiyat_haric, f.kdv_orani);
  perform set_config('kahve.sistem', '', true);
end $$;
