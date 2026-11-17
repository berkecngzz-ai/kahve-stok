# Fatura okuma testi — Colombia Coffee Alanya

11 gerçek belge (fatura, irsaliye, fiş) + elle doğrulanmış doğru cevaplar.
Okuyucu her belgeyi okur, puanlayıcı sonucu doğru cevapla karşılaştırır, `results/` altına rapor yazar.

## Kurulum
```
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
```

## Çalıştırma
```
python run_test.py --reader mock              # önce bu: puanlayıcı çalışıyor mu (4 bilinçli hata yakalanmalı)
python run_test.py --reader claude            # Claude API ile referans okuma
python run_test.py --reader claude --runs 3   # 3 tur: aynı belge her seferinde aynı mı okunuyor
python run_test.py --reader command           # kendi uygulamanın okuyucusu (READER_CMD ile)
python run_test.py --reader claude --only 05  # tek belge
```
Model değiştirmek için: `READER_MODEL=claude-haiku-5-5 python run_test.py`

## Ne ölçülüyor
- **Belge başlığı:** tip, tarih, belge no, genel toplam (±0,05 TL)
- **Her kalem:** bulundu mu, stok/gider sınıfı, miktar, stok miktarı (birim serbest), tutar (±%2)
- **Tuzaklar** (gerçek hayatta stok hesabını bozan durumlar):
  - "750 ML\*12" koli çarpanı → 4 şişe olmalı, 48 değil
  - Söylemezoğlu 25 koli → 360 şişe
  - Jüt ip / reklam / temizlik stoğa girmemeli
  - "MEYVE 400 TL" → kg sorulmalı
  - ŞOK peynirde gramaj yok → işaretlenmeli
  - İrsaliyede fiyat uydurulmamalı
  - Sütaş 180 L süt doğru okunmalı

## Okuyucu çıktı şeması
`scorer.py` dosyasının başında. Kendi okuyucun farklı şema dönüyorsa `readers/command_reader.py` içinde dönüştür.

## Yeni belge eklemek
Fotoğrafı `data/images/` içine koy, `data/ground_truth.json`'a aynı şemada doğru cevabını ekle.
Hedef: en az 30 belge, farklı tedarikçiler, kötü çekilmiş fotoğraflar dahil.
