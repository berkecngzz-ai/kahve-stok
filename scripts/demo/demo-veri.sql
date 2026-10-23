-- "Demo Kafe": 4 haftalık gerçekçi demo verisi. YALNIZ YEREL DEMO İÇİN — canlı Supabase'de ÇALIŞTIRMA.
-- scripts/demo/sunucu.mjs bunu boş bir yerel veritabanına (PGlite) kurar. Tarihler bugüne göre geriye doğru.
--
-- Demo hesapları (yalnız yerel demo sunucusunda geçerli, gerçek hesap değildir):
-- hesap: patron@demo.kafe demo1234
-- hesap: barista@demo.kafe demo1234
--
-- Senaryo
--   * 28 gün önce ilk sayım; sonra her 7 günde bir haftalık sayım (4 hafta → 4 açık raporu).
--   * Her gün satış (hafta sonu daha yoğun), ara sıra fire; süt haftada 2, kahve haftada 1 kez gelir.
--   * Sayımda bulunan = sistemin beklediği − görünmeyen kayıp. Normal haftalarda kayıp küçük (%0,5–1,5).
--   * 3. haftada (14 → 7 gün önce) sütte büyük açık: ~16 litre fazladan kayıp.
--   * Dün gelen bir Metro faturası okunamadı, eşleştirme bekliyor (patron uyarıyı görür).

insert into auth.users values
  ('d0000000-0000-4000-8000-000000000001', 'patron@demo.kafe'),
  ('d0000000-0000-4000-8000-000000000002', 'barista@demo.kafe');

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', false),
       set_config('request.jwt.claim.email', 'patron@demo.kafe', false);
set role authenticated;
select public.mekan_olustur('Demo Kafe', 'Ayşe Yılmaz');
select davet_kodu as kod from public.mekanlar where ad = 'Demo Kafe' \gset
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', false),
       set_config('request.jwt.claim.email', 'barista@demo.kafe', false);
select public.mekana_katil(:'kod', 'Mert');
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', false),
       set_config('request.jwt.claim.email', 'patron@demo.kafe', false);

do $$
declare
  PATRON constant text := 'd0000000-0000-4000-8000-000000000001';
  BARISTA constant text := 'd0000000-0000-4000-8000-000000000002';
  m jsonb := '{}';         -- malzeme adı kısaltması → id
  u jsonb := '{}';         -- ürün adı → id
  r record;
  d int;                   -- kaç gün önce
  gun date;
  hafta int;
  carpan numeric;
  satis jsonb;
  kalem jsonb;
  sayim jsonb;
  onceki date;
  teorik numeric;
  kayip numeric;
  bulunan numeric;
  adim numeric;
  -- Ürünler: ad, hafta içi günlük ortalama adet, tarif (malzeme kısaltması → g/ml/adet)
  urunler jsonb := '[
    ["Espresso",        8, {"kahve":18, "b4":1}],
    ["Americano",      14, {"kahve":18, "b12":1, "kapak":1}],
    ["Latte",          26, {"kahve":18, "sut":220, "b12":1, "kapak":1}],
    ["Cappuccino",     14, {"kahve":18, "sut":160, "b8":1, "kapak":1}],
    ["Flat White",      6, {"kahve":18, "sut":130, "b8":1, "kapak":1}],
    ["Karamel Latte",   8, {"kahve":18, "sut":200, "karamel":25, "b12":1, "kapak":1}],
    ["Vanilya Latte",   6, {"kahve":18, "sut":200, "vanilya":25, "b12":1, "kapak":1}],
    ["Yulaf Sütlü Latte", 5, {"kahve":18, "yulaf":220, "b12":1, "kapak":1}],
    ["Mocha",           5, {"kahve":18, "sut":180, "cikolata":30, "b12":1, "kapak":1}],
    ["Filtre Kahve",   10, {"kahve":15, "b12":1, "kapak":1}],
    ["Çay",            30, {"cay":3}],
    ["Sıcak Çikolata",  4, {"sut":220, "cikolata":40, "b12":1, "kapak":1}]
  ]';
  -- Malzemeler: kısaltma, ad, birim, KDV dahil fiyat (kg / litre / adet), KDV %, ilk sayım, sayım hassasiyeti,
  -- normal haftalık görünmeyen kayıp oranı.
  malz jsonb := '[
    ["kahve",    "Espresso çekirdeği",     "g",   1150, 1,  8000, 10,  0.008],
    ["sut",      "Süt (tam yağlı)",        "ml",    44, 1, 30000, 500, 0.012],
    ["yulaf",    "Yulaf sütü",             "ml",   110, 1,  6000, 250, 0.005],
    ["karamel",  "Karamel şurubu 700 ml",  "ml",   640, 20, 1400, 50,  0.0],
    ["vanilya",  "Vanilya şurubu 700 ml",  "ml",   640, 20, 1400, 50,  0.0],
    ["cikolata", "Çikolata sosu",          "ml",   520, 20, 3000, 50,  0.0],
    ["cay",      "Siyah çay",              "g",    420, 1,  1500, 10,  0.0],
    ["b4",       "Espresso bardağı 4 oz",  "adet", 1.6, 20,   80, 1,   0.0],
    ["b8",       "Karton bardak 8 oz",     "adet", 2.4, 20,  250, 1,   0.004],
    ["b12",      "Karton bardak 12 oz",    "adet", 2.9, 20,  800, 1,   0.004],
    ["kapak",    "Bardak kapağı",          "adet", 1.1, 20, 1100, 1,   0.004]
  ]';
  x jsonb;
  -- Faturalar: [kaç gün önce, tedarikçi, [[kısaltma, miktar(g/ml/adet), KDV dahil birim fiyat (kg/L/adet)], …]]
  faturalar jsonb := '[
    [27, "Kavruk Kahve Kavurma", [["kahve", 15000, 1150]]],
    [27, "Yıldız Süt",           [["sut", 54000, 44]]],
    [26, "Metro Toptan",         [["yulaf", 9000, 110], ["karamel", 2100, 640], ["vanilya", 1400, 640], ["cikolata", 2500, 520], ["cay", 1000, 420]]],
    [25, "Ambalajcı Murat",      [["b12", 1300, 2.9], ["b8", 350, 2.4], ["b4", 150, 1.6], ["kapak", 1700, 1.1]]],
    [24, "Yıldız Süt",           [["sut", 54000, 44]]],
    [20, "Kavruk Kahve Kavurma", [["kahve", 15000, 1150]]],
    [20, "Yıldız Süt",           [["sut", 54000, 44]]],
    [19, "Metro Toptan",         [["yulaf", 9000, 110], ["karamel", 2100, 640], ["vanilya", 1400, 640], ["cikolata", 2500, 520]]],
    [17, "Yıldız Süt",           [["sut", 54000, 44]]],
    [13, "Kavruk Kahve Kavurma", [["kahve", 15000, 1150]]],
    [13, "Yıldız Süt",           [["sut", 54000, 46]]],
    [12, "Metro Toptan",         [["yulaf", 9000, 110], ["karamel", 2100, 640], ["vanilya", 1400, 640], ["cikolata", 2500, 520], ["cay", 1000, 420]]],
    [11, "Ambalajcı Murat",      [["b12", 1300, 2.9], ["b8", 350, 2.4], ["b4", 150, 1.6], ["kapak", 1700, 1.1]]],
    [10, "Yıldız Süt",           [["sut", 54000, 46]]],
    [6,  "Kavruk Kahve Kavurma", [["kahve", 15000, 1150]]],
    [6,  "Yıldız Süt",           [["sut", 54000, 46]]],
    [5,  "Metro Toptan",         [["yulaf", 9000, 110], ["karamel", 2100, 640], ["vanilya", 1400, 640], ["cikolata", 2500, 520]]],
    [3,  "Yıldız Süt",           [["sut", 54000, 46]]]
  ]';
  f jsonb;
  kalemler jsonb;
  toplam numeric;
  oran numeric;
  fiyat numeric;
begin
  -- Malzemeler (patron)
  for x in select * from jsonb_array_elements(malz) loop
    insert into malzemeler (ad, birim, fiyat) values (x->>1, x->>2, (x->>3)::numeric) returning id into r;
    m := m || jsonb_build_object(x->>0, r.id);
  end loop;
  -- Ürünler ve tarifler
  for x in select * from jsonb_array_elements(urunler) loop
    select jsonb_agg(jsonb_build_object('malzeme_id', m->>t.key, 'miktar', t.value::numeric))
      into kalemler from jsonb_each_text(x->2) t;
    u := u || jsonb_build_object(x->>0, urun_kaydet(null, x->>0, kalemler));
  end loop;

  -- İlk sayım (28 gün önce, barista)
  perform set_config('request.jwt.claim.sub', BARISTA, true);
  perform giris_kaydet('sayim', bugun() - 28, null,
    (select jsonb_agg(jsonb_build_object('malzeme_id', m->>(y->>0), 'miktar', (y->>5)::numeric)) from jsonb_array_elements(malz) y));
  onceki := bugun() - 28;

  for d in reverse 27..0 loop
    gun := bugun() - d;
    hafta := 4 - d / 7;   -- 27..21 → 1. hafta, 20..14 → 2., 13..7 → 3., 6..0 → 4. (sayım günü haftasının son günü)

    -- Faturalar (patron girer; KDV dahil fiyattan KDV hariç tutar)
    perform set_config('request.jwt.claim.sub', PATRON, true);
    for f in select * from jsonb_array_elements(faturalar) where (value->>0)::int = d loop
      kalemler := '[]'; toplam := 0;
      for kalem in select * from jsonb_array_elements(f->2) loop
        select (y->>4)::numeric into oran from jsonb_array_elements(malz) y where y->>0 = kalem->>0;
        fiyat := round((kalem->>1)::numeric * (kalem->>2)::numeric
                       / (case when (select y->>2 from jsonb_array_elements(malz) y where y->>0 = kalem->>0) = 'adet' then 1 else 1000 end), 2);
        kalemler := kalemler || jsonb_build_object('malzeme_id', m->>(kalem->>0), 'miktar', (kalem->>1)::numeric,
          'tutar_kdv_haric', round(fiyat / (1 + oran / 100), 2), 'kdv_orani', oran);
        toplam := toplam + round(round(fiyat / (1 + oran / 100), 2) * (1 + oran / 100), 2);
      end loop;
      perform fatura_kaydet(gun, f->>1, kalemler, jsonb_build_object('genel', toplam), '[]');
    end loop;

    -- Gün sonu satış (barista). Hafta sonu %40 yoğun; ürün başına küçük, tekrarlanabilir dalgalanma.
    perform set_config('request.jwt.claim.sub', BARISTA, true);
    carpan := case when extract(isodow from gun) in (6, 7) then 1.4 else 1 end;
    satis := '[]';
    for x in select value from jsonb_array_elements(urunler) with ordinality t(value, i) loop
      satis := satis || jsonb_build_object('urun_id', u->>(x->>0),
        'miktar', greatest(0, round((x->>1)::numeric * carpan * (0.85 + ((d * 5 + length(x->>0) * 3) % 7) * 0.05))));
    end loop;
    perform giris_kaydet('satis', gun, null, satis);

    -- Fire: bazı günler süt dökülmesi, değirmen ayarı
    if d % 3 = 0 then
      perform giris_kaydet('fire', gun, 'Süt döküldü',
        jsonb_build_array(jsonb_build_object('malzeme_id', m->>'sut', 'miktar', 400)));
    end if;
    if d % 7 = 2 then
      perform giris_kaydet('fire', gun, 'Değirmen ayarı',
        jsonb_build_array(jsonb_build_object('malzeme_id', m->>'kahve', 'miktar', 60)));
    end if;

    -- Haftalık sayım (gün sonu): sistemin beklediği − görünmeyen kayıp, sayım hassasiyetine yuvarlanmış.
    if d in (21, 14, 7, 0) then
      perform set_config('request.jwt.claim.sub', PATRON, true);   -- hareketleri yalnız patron görür
      sayim := '[]';
      for x in select * from jsonb_array_elements(malz) loop
        select coalesce(sum(case g.tur when 'sayim' then 0 when 'fatura' then h.miktar else -h.miktar end), 0)
          into teorik
          from malzeme_hareketleri h join girisler g on g.id = h.giris_id
          where h.malzeme_id = (m->>(x->>0))::uuid and g.iptal_zamani is null
            and g.tur in ('fatura', 'satis', 'fire') and g.tarih > onceki and g.tarih <= gun;
        select h.miktar + teorik into teorik
          from malzeme_hareketleri h join girisler g on g.id = h.giris_id
          where h.malzeme_id = (m->>(x->>0))::uuid and g.tur = 'sayim' and g.iptal_zamani is null and g.tarih = onceki;
        -- kayıp: haftalık kullanımın normal oranı; 3. haftada sütte büyük açık
        select coalesce(sum(h.miktar), 0) * (x->>7)::numeric into kayip
          from malzeme_hareketleri h join girisler g on g.id = h.giris_id
          where h.malzeme_id = (m->>(x->>0))::uuid and g.tur in ('satis', 'fire') and g.iptal_zamani is null
            and g.tarih > onceki and g.tarih <= gun;
        if x->>0 = 'sut' and hafta = 3 then kayip := kayip + 16000; end if;
        adim := (x->>6)::numeric;
        bulunan := greatest(0, round((teorik - kayip) / adim) * adim);
        sayim := sayim || jsonb_build_object('malzeme_id', m->>(x->>0), 'miktar', bulunan);
      end loop;
      perform set_config('request.jwt.claim.sub', BARISTA, true);
      perform giris_kaydet('sayim', gun, null, sayim);
      onceki := gun;
    end if;
  end loop;
end $$;

-- Dün gelen Metro faturası fotoğraftan okunamadı; eşleştirme bekliyor (kurulum kuyruğunda).
reset role;
insert into public.belgeler (mekan_id, tur, kaynak, istek_id, tedarikci, belge_tarihi, genel_toplam, durum, giren, giren_ad)
select id, 'fatura', 'ocr', gen_random_uuid(), 'Metro Toptan', public.bugun() - 1, 1840.00, 'bekliyor',
       'd0000000-0000-4000-8000-000000000002', 'Mert'
from public.mekanlar where ad = 'Demo Kafe';
