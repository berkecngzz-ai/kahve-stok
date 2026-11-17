"""Puanlayıcının kendisini test etmek için: doğru cevabı alıp tipik AI hataları ekler."""
import copy, json, os

GT = {d["dosya"]: d for d in json.load(open(os.path.join(os.path.dirname(__file__), "..", "data", "ground_truth.json")))["belgeler"]}


def read(image_path):
    d = copy.deepcopy(GT[os.path.basename(image_path)])
    f = d["dosya"]
    if f == "05_arslanlar_fatura.jpg":           # koli çarpanı hatası
        for k in d["kalemler"]:
            k["miktar"] *= 12; k["stok_miktar"] *= 12
    if f == "07_manav_fis.jpg":                  # belirsizliği görmezden gelir
        d["kalemler"][0].update(miktar=1, stok_miktar=1, belirsiz=None)
    if f == "09_metro_5669.jpg":                 # temizliği stok sanar
        d["kalemler"][5]["sinif"] = "stok"
    if f == "02_smb_temmuz.jpg":                 # toplamı yanlış okur
        d["genel_toplam"] = 9036.99
    return d
