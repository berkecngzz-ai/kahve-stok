"""Kendi uygulamanın okuyucusunu bağlamak için.
READER_CMD ortam değişkenine, fotoğraf yolunu argüman alıp stdout'a JSON basan bir komut ver.
Örnek: READER_CMD="node ../app/scripts/read-invoice.js"
"""
import json, os, shlex, subprocess


def read(image_path):
    cmd = shlex.split(os.environ["READER_CMD"]) + [image_path]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=180, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])
