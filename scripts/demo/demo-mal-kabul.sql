-- Demo: bugün gelen süt faturasında 24 L yazıyor, barista 22 L saydı (kör sayım) → patronun Özet'inde
-- "Teslimat kontrolü" görevi. YALNIZ YEREL DEMO İÇİN; sql/21_mal_kabul.sql gerektirir (demo sunucusu ekler).
reset role;
-- Fiyat baristaya kapalı: faturanın tutarı yönetici olarak hazırlanır (24 L × litre fiyatı).
select m.id as sut, round(coalesce(m.fiyat_haric, m.fiyat, 40) * 24, 2) as haric, coalesce(m.kdv_orani, 1) as oran
  from public.malzemeler m join public.mekanlar k on k.id = m.mekan_id
  where k.ad = 'Demo Kafe' and m.ad like 'Süt%' order by m.ad limit 1 \gset
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', false),
       set_config('request.jwt.claim.email', 'barista@demo.kafe', false);
set role authenticated;
select public.belge_kaydet(jsonb_build_object(
  'istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'tedarikci', 'Anadolu Süt Ürünleri',
  'tedarikci_vkn', '4444444444', 'tarih', public.bugun(), 'fatura_no', 'ASU2026000000412',
  'toplamlar', jsonb_build_object('genel', round(:haric * (1 + :oran / 100.0), 2)),
  'okunan', jsonb_build_object('not', 'demo'),
  'satirlar', jsonb_build_array(jsonb_build_object(
    'metin', 'TAM YAĞLI SÜT 1 LT', 'miktar', 24, 'birim', 'lt', 'tutar_haric', :haric,
    'kdv_orani', :oran, 'sinif', 'eslesti', 'malzeme_id', :'sut', 'carpan', 1000,
    'barista_onayi', true, 'gelen_miktar', 22, 'sayim', 'sayildi', 'teslimat', 'teslimat_farki',
    'barista_notu', 'İki şişe eksik geldi, şoföre söyledim'))));
reset role;
-- Demo düzeltmesi: bu teslimat bugünkü haftalık sayımdan önce rafa girmiş sayılır (sayılan 22 L dahil),
-- yoksa demo raporunda sahte bir açık görünür. Yalnız demo verisi.
update public.malzeme_hareketleri h set miktar = h.miktar + 22000
  from public.girisler g
  where g.id = h.giris_id and g.tur = 'sayim' and g.tarih = public.bugun() and h.malzeme_id = :'sut';
