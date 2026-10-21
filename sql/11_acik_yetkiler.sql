-- 11: Eksik açık yetki — mekanlar ve uyeler için authenticated'a SELECT.
-- 01_giris_mekan.sql bu iki tabloda yalnız insert/update/delete'i geri aldı; SELECT, Supabase'in eski varsayılan
-- yetkisinden geliyordu. Supabase 30 Ekim 2026'dan sonra yeni projelerde public şemadaki tablolara varsayılan yetki
-- vermiyor; migration'lar yeni bir projede çalıştırılırsa giriş ekranı (uyeler + mekanlar okuması) 42501 ile kırılır.
-- Canlıda bu yetki zaten var: bu dosya davranışı değiştirmez, yalnız yetkiyi açıkça yazar. RLS politikaları aynen geçerli.
grant select on public.mekanlar, public.uyeler to authenticated;
