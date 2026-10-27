-- 29_sayim_tarihi.sql: sayımın tarihi düzeltilebilir (patron).
-- Neden: rapor dönemi sayım GÜNLERİ arasındadır (sayım = o günün kapanışı; o günün satışı/faturası dönemin içinde).
-- Barista kapanışta saydığını ertesi sabah gönderirse sayım yanlış güne düşer ve dönem kayar. Fatura teslim tarihindeki
-- gibi (sql/26 fatura_teslim_tarihi) patron tarihi düzeltir; raporlar hareket tarihine göre yeniden hesaplanır.
-- Kurallar: gelecek tarih yok, 366 günden eski yok; o güne zaten başka (iptal edilmemiş) sayım varsa reddedilir
-- (aynı güne iki sayım tek sayım gibi birleşir, sessizce karışmasın). Her düzeltme işlem geçmişine yazılır.
begin;

alter table public.islem_gecmisi drop constraint if exists islem_gecmisi_tur_check;
alter table public.islem_gecmisi add constraint islem_gecmisi_tur_check
  check (tur in ('giris', 'giris_iptal', 'belge_iptal', 'mal_kabul', 'teslimat_farki', 'fark_cozuldu', 'fiyat_onay',
                 'teslim_tarihi', 'sayim_duzelt', 'sayim_tarihi'));

create or replace function public.sayim_tarihi(p_giris uuid, p_tarih date) returns void
language plpgsql security definer set search_path = public as $$
declare g girisler;
begin
  if not patron_muyum() then raise exception 'Sayım tarihini yalnız patron düzeltebilir.'; end if;
  select * into g from girisler where id = p_giris and mekan_id = benim_mekanim() for update;
  if not found or g.tur <> 'sayim' then raise exception 'Sayım bulunamadı.'; end if;
  if g.iptal_zamani is not null then raise exception 'Bu sayım iptal edilmiş.'; end if;
  if p_tarih is null or p_tarih > bugun() or p_tarih < bugun() - 366 then raise exception 'Sayım tarihi geçersiz.'; end if;
  if p_tarih = g.tarih then return; end if;
  if exists (select 1 from girisler where mekan_id = g.mekan_id and tur = 'sayim' and iptal_zamani is null
             and tarih = p_tarih and id <> g.id) then
    raise exception 'O gün zaten bir sayım var. Önce onu iptal et ya da başka bir gün seç.';
  end if;
  update girisler set tarih = p_tarih where id = p_giris;
  perform islem_yaz(g.mekan_id, 'sayim_tarihi', g.id, null, jsonb_build_object('eski', g.tarih, 'yeni', p_tarih));
end $$;

revoke all on function public.sayim_tarihi(uuid, date) from public, anon;
grant execute on function public.sayim_tarihi(uuid, date) to authenticated;

commit;
