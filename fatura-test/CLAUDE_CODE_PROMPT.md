Bu klasörü projenin içine `fatura-test/` olarak koydum. İçinde 11 gerçek fatura/fiş fotoğrafı,
elle doğrulanmış doğru cevaplar (data/ground_truth.json) ve bir puanlayıcı var. README.md'yi oku.

Görevin:
1. `python fatura-test/run_test.py --reader mock` çalıştır; 4 bilinçli hatanın yakalandığını doğrula.
2. Uygulamamızdaki fatura okuma kodunu bul. Bir fotoğraf yolunu alıp stdout'a JSON basan küçük bir
   komut satırı scripti yaz (scorer.py başındaki şemaya çevirerek). READER_CMD ile command_reader'a bağla.
3. `python fatura-test/run_test.py --reader command --runs 3` çalıştır.
4. Karşılaştırma için `--reader claude --runs 3` da çalıştır.
5. İki raporu yan yana koy ve bana kısaca söyle: genel doğruluk, hangi tuzaklarda düştük,
   tutarsız (turdan tura değişen) belgeler hangileri, belge başına süre.
6. Düşülen her tuzak için uygulamadaki prompt'a/koda önerdiğin düzeltmeyi yaz ama UYGULAMA;
   önce bana göster.

Puanlayıcıyı ya da doğru cevapları, testi geçmek için değiştirme. Doğru cevapta hata olduğunu
düşünürsen fotoğrafa bakıp bana gerekçesiyle söyle.
