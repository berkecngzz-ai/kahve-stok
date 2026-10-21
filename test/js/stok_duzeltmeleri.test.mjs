// 2026-10-21 denetimindeki eşleştirme hataları: ölçü birimi + paket boyu belirsizliği, eskimiş "takip dışı" kararı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carpanBul, siniflandir, aiIleSiniflandir, takipDisiEskimis } from '../../eslestirme.js';

test('ölçü birimi okunmuş ama adda başka paket boyu var → çarpan bilinmez (kurulum)', () => {
  // Canlıdaki hata: "SODA SADE 200ML" × 24, birim ml → çarpan 1 → 24 ml stok, 14.500 ₺/litre
  assert.equal(carpanBul('ml', 'ml', 'SODA SADE 200ML'), null);
  assert.equal(carpanBul('kg', 'g', 'BEYAZ TOZ ŞEKER 5 KG'), null);      // 2 kg mı 2 paket (10 kg) mı?
  assert.equal(carpanBul('g', 'g', 'KAHVE 250G'), null);
  // Paket boyu tam bir belge birimiyse çelişki yok
  assert.equal(carpanBul('kg', 'g', 'TOZ ŞEKER 1KG'), 1000);
  assert.equal(carpanBul('lt', 'ml', 'BARISTA SÜT 1LT'), 1000);
  assert.equal(carpanBul('lt', 'ml', 'SÜT 1L X 12'), 1000);
  assert.equal(carpanBul('ml', 'ml', 'SÜT 1000 ML'), null);               // 1000 ml ≠ 1 ml
  assert.equal(carpanBul('kg', 'g', 'T.ÇEKİRDEK KAHVE 1KG'), 1000);
  assert.equal(carpanBul('kg', 'g', 'LİMON'), 1000);                      // boy yok
  // Adet / paket birimi eskisi gibi: şişe sayısı × paket boyu
  assert.equal(carpanBul('adet', 'ml', 'SODA SADE 200ML'), 200);
  assert.equal(carpanBul('adet', 'ml', 'Monin Vanilya Şurubu 700 ml'), 700);
});

test('soda satırı artık sorusuz/otomatik 1 çarpanla stoğa gitmez', () => {
  const malzemeler = [{ id: 'soda', ad: 'Sade maden suyu 200 ml', birim: 'ml', aktif: true }];
  const ctx = { malzemeler, defter: [], tedarikciAnahtar: '5891234701' };
  const s = { metin: 'SODA SADE 200ML', miktar: 24, birim: 'ml' };
  assert.notEqual(siniflandir(s, ctx).carpan, 1);
  // AI "maden suyu, 24 ml" dese bile: adda 200 ml paket yazıyor, AI'nın 1 çarpanı kuralla çelişir → kurulum
  const ai = { karar: 'malzeme', malzeme_id: 'soda', stok_miktari: 24, guven: 0.9 };
  assert.equal(aiIleSiniflandir({ ...s, ai }, ctx).sinif, 'belirsiz');
  // AI 4800 ml derse (24 × 200) tutarlı → baristaya sorulur, çarpan 200
  const ai2 = { karar: 'malzeme', malzeme_id: 'soda', stok_miktari: 4800, guven: 0.9 };
  const ctx2 = { ...ctx, malzemeler: [{ id: 'soda', ad: 'Sade soda', birim: 'ml', aktif: true }] };
  const r = aiIleSiniflandir({ metin: 'SODA SADE 200ML', miktar: 24, birim: 'adet', ai: ai2 }, ctx2);
  assert.equal(r.sinif, 'soru');
  assert.equal(r.carpan, 200);
});

test('takip dışı kararından sonra eklenen malzeme: satır yeniden kuruluma gider', () => {
  const karar = '2026-10-21T02:37:09Z';
  const defter = [{ tedarikci_anahtar: '4820193756', metin_anahtar: 'karton bardak 12 oz 50 li', birim: 'diger',
    sonuc: 'takip_disi', guncelleme: karar }];
  const sonra = [{ id: 'bardak', ad: 'Karton bardak 12 oz', birim: 'adet', aktif: true, olusturma: '2026-10-21T02:45:47Z' }];
  const once = [{ ...sonra[0], olusturma: '2026-10-20T10:00:00Z' }];
  const s = { metin: "Karton Bardak 12 oz / 50'li", miktar: 6, birim: 'diger' };
  const ctx = (malzemeler) => ({ malzemeler, defter, tedarikciAnahtar: '4820193756' });
  assert.deepEqual(siniflandir(s, ctx(sonra)), { sinif: 'belirsiz', aday_malzeme_id: 'bardak' });
  assert.deepEqual(aiIleSiniflandir({ ...s, ai: { karar: 'takip_disi', guven: 0.95 } }, ctx(sonra)),
    { sinif: 'belirsiz', aday_malzeme_id: 'bardak' });
  // Malzeme karardan ÖNCE vardı → bilerek dışarıda bırakılmış, karar geçerli
  assert.equal(siniflandir(s, ctx(once)).sinif, 'takip_disi');
  // Pasif malzeme ya da türev ürün kararı bozmaz
  assert.equal(siniflandir(s, ctx([{ ...sonra[0], aktif: false }])).sinif, 'takip_disi');
  assert.equal(takipDisiEskimis({ sonuc: 'takip_disi', guncelleme: karar }, 'SÜT TOZU 500G',
    [{ id: 'sut', ad: 'Süt', birim: 'ml', aktif: true, olusturma: '2026-10-22T00:00:00Z' }]), null);
  // Tarih bilinmiyorsa (eski istemci verisi) karar geçerli
  assert.equal(takipDisiEskimis({ sonuc: 'takip_disi' }, s.metin, sonra), null);
});
