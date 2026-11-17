"""Referans okuyucu: fotoğrafı Claude API'ye gönderir, JSON döner.
Senin uygulamandaki okuyucu farklıysa command_reader ile kendininkini bağla.
Gerekli: pip install anthropic ; ANTHROPIC_API_KEY ortam değişkeni.
"""
import base64, json, os, re

PROMPT = """Bu bir kafe/bar mekanına ait alış belgesinin fotoğrafı (fatura, irsaliye veya yazarkasa fişi).
Stok takibi için oku ve SADECE aşağıdaki JSON'u döndür, başka metin yazma.

{
  "tip": "fatura" | "irsaliye" | "fis",
  "tedarikci": "satıcı firma kısa adı",
  "no": "fatura/irsaliye numarası, fişte null",
  "tarih": "YYYY-MM-DD",
  "genel_toplam": KDV dahil ödenecek tutar (sayı) veya null,
  "kalemler": [{
    "urun": "ürün adı",
    "miktar": belgede yazan miktar (sayı) veya null,
    "birim": "adet/koli/şişe/kg/paket...",
    "stok_miktar": sayılabilir en küçük birimde miktar (sayı) veya null,
    "stok_birim": "L, ml, şişe, kg, paket, adet...",
    "tutar": KDV dahil satır tutarı veya null,
    "sinif": "stok" | "gider",
    "belirsiz": "eksik bilgi varsa kullanıcıya sorulacak kısa soru, yoksa null"
  }]
}

Kurallar:
- stok: mekanda satılan ürünlere giren malzeme (süt, şurup, dondurma, şarküteri, sebze-meyve, içecek).
  gider: temizlik, poşet, ip, reklam, hizmet vb.
- Ürün adındaki "750 ML*12" gibi ifadeler koli içeriğidir; miktar sütunu gerçek adettir. Ürün adında
  hacim varsa (1 L, 5.5L, 750 ML) stok_miktar'ı hacim cinsinden de verebilirsin; birimi stok_birim'e yaz.
- Miktar "koli/kutu" ise ve koli içi adet ürün adında yazıyorsa (12TV, 6BSx4 = 24) stok_miktar = toplam şişe.
- İrsaliyede fiyat yoksa tutar null bırak, uydurma.
- Fişte ürün cinsi veya miktarı yoksa (ör. sadece "MEYVE"), stok_miktar null ve belirsiz alanına soru yaz.
- Paketli ürünün gramajı belgede yoksa belirsiz alanına gramaj sorusu yaz.
"""

MODEL = os.environ.get("READER_MODEL", "claude-sonnet-5-5")


def read(image_path):
    import anthropic
    client = anthropic.Anthropic()
    data = base64.standard_b64encode(open(image_path, "rb").read()).decode()
    msg = client.messages.create(
        model=MODEL, max_tokens=4000,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
            {"type": "text", "text": PROMPT}]}])
    text = "".join(b.text for b in msg.content if b.type == "text")
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0))
