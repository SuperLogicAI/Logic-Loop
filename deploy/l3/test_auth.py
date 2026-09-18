"""Run: python deploy/l3/test_auth.py"""
import http.client
import os
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

with tempfile.NamedTemporaryFile("w", delete=False) as f:
    f.write("s3cret\n")
os.environ["L3_PASSWORD_FILE"] = f.name
import auth  # noqa: E402

server = ThreadingHTTPServer(("127.0.0.1", 0), auth.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()


def req(method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
    conn.request(method, path, body, headers or {})
    resp = conn.getresponse()
    return resp.status, dict(resp.getheaders()), resp.read().decode("utf-8", "replace")


def login(user, password, nxt="/vnc.html"):
    form = urlencode({"username": user, "password": password, "next": nxt})
    return req("POST", "/l3/login", form, {"Content-Type": "application/x-www-form-urlencoded"})


status, headers, _ = req("GET", "/l3/verify", headers={"X-Forwarded-Uri": "/vnc.html?a=1"})
assert status == 302 and headers["Location"] == "/l3/login?next=%2Fvnc.html%3Fa%3D1", headers

status, _, page = req("GET", "/l3/login?next=%22%3E%3Cscript%3E")
assert status == 200 and "<script>" not in page and "{{" not in page and 'value="/"' in page

status, headers, _ = login("logicloop", "wrong")
assert status == 303 and headers["Location"].endswith("&error=1") and "Set-Cookie" not in headers
assert "match" in req("GET", headers["Location"])[2]

status, headers, _ = login("logicloop", "s3cret", "//evil.example/")
assert status == 303 and headers["Location"] == "/"

status, headers, _ = login("logicloop", "s3cret")
assert status == 303 and headers["Location"] == "/vnc.html"
cookie = headers["Set-Cookie"].split(";")[0]
assert "HttpOnly" in headers["Set-Cookie"] and "Secure" in headers["Set-Cookie"]
assert req("GET", "/l3/verify", headers={"Cookie": cookie})[0] == 200

forged = cookie[:-1] + ("0" if cookie[-1] != "0" else "1")
assert req("GET", "/l3/verify", headers={"Cookie": forged})[0] == 302
assert req("GET", "/l3/verify", headers={"Cookie": "l3_session=1.abc"})[0] == 302
assert req("GET", "/l3/superlogicai.png")[0] == 200
assert req("GET", "/l3/auth.py")[0] == 404

auth.failures[:] = [__import__("time").time()] * 10
assert login("logicloop", "s3cret")[1]["Location"].endswith("&error=2")

Path(f.name).unlink()
print("PASS")
