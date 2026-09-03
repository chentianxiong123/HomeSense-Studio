import base64
import hashlib
import random
import time
from gzip import GzipFile
from io import BytesIO

from Crypto.Cipher import ARC4


def gen_nonce() -> str:
    millis = int(round(time.time() * 1000))
    b = (random.getrandbits(64) - 2**63).to_bytes(8, "big", signed=True)
    part2 = int(millis / 60000)
    b += part2.to_bytes(((part2.bit_length() + 7) // 8), "big")
    return base64.b64encode(b).decode("utf-8")


def get_signed_nonce(ssecurity: str, nonce: str) -> str:
    m = hashlib.sha256()
    m.update(base64.b64decode(bytes(ssecurity, "utf-8")))
    m.update(base64.b64decode(bytes(nonce, "utf-8")))
    return base64.b64encode(m.digest()).decode("utf-8")


def gen_enc_signature(uri: str, method: str, signed_nonce: str, params: dict) -> str:
    signature_params = [str(method).upper(), uri]
    for k, v in params.items():
        signature_params.append(f"{k}={v}")
    signature_params.append(signed_nonce)
    signature_string = "&".join(signature_params)
    return base64.b64encode(hashlib.sha1(signature_string.encode("utf-8")).digest()).decode()


def generate_enc_params(uri: str, method: str, signed_nonce: str, nonce: str, params: dict, ssecurity: str) -> dict:
    params["rc4_hash__"] = gen_enc_signature(uri, method, signed_nonce, params)
    for k, v in params.items():
        params[k] = encrypt_rc4(signed_nonce, v)
    params.update({
        "signature": gen_enc_signature(uri, method, signed_nonce, params),
        "ssecurity": ssecurity,
        "_nonce": nonce,
    })
    return params


def encrypt_rc4(password: str, payload: str) -> str:
    r = ARC4.new(base64.b64decode(password))
    r.encrypt(bytes(1024))
    return base64.b64encode(r.encrypt(payload.encode())).decode()


def decrypt_rc4(password: str, payload: str) -> bytes:
    r = ARC4.new(base64.b64decode(password))
    r.encrypt(bytes(1024))
    return r.encrypt(base64.b64decode(payload))


def decrypt(ssecurity: str, nonce: str, payload: str) -> str:
    decrypted = decrypt_rc4(get_signed_nonce(ssecurity, nonce), payload)
    try:
        return decrypted.decode("utf-8")
    except UnicodeDecodeError:
        compressed_file = BytesIO(decrypted)
        return GzipFile(fileobj=compressed_file, mode="rb").read().decode("utf-8")
