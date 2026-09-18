"""Session login for the L3 public URL. Caddy calls /l3/verify before every request."""
import hashlib
import hmac
import html
import os
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

HERE = Path(__file__).parent
USER = os.environ.get("L3_USER", "logicloop")
PASSWORD = Path(os.environ.get("L3_PASSWORD_FILE", "/run/l3-password")).read_text().strip()
SECRET = secrets.token_bytes(32)  # restarting the service signs everyone out
SESSION_SECONDS = 12 * 3600
COOKIE = "l3_session"
ASSETS = {"superlogicai.png": "image/png", "logic-loop.png": "image/png"}
ERRORS = {
    "1": "That username and password don't match. Check both and try again.",
    "2": "Too many sign-in attempts. Wait a minute, then try again.",
}
failures = []  # ponytail: global throttle, per-client limits need the real client IP


def sign(expires):
    return hmac.new(SECRET, str(expires).encode(), hashlib.sha256).hexdigest()


def valid_session(cookie_header):
    for part in (cookie_header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE:
            expires, _, sig = value.partition(".")
            return expires.isdigit() and int(expires) > time.time() and hmac.compare_digest(sig, sign(expires))
    return False


def safe_next(target):
    target = target or "/"
    return target if target.startswith("/") and not target.startswith("//") and "\\" not in target else "/"


class Handler(BaseHTTPRequestHandler):
    def redirect(self, location, cookie=None):
        self.send_response(303 if self.command == "POST" else 302)
        self.send_header("Location", location)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        if url.path == "/l3/verify":
            if valid_session(self.headers.get("Cookie")):
                self.send_response(200)
                self.end_headers()
            else:
                self.redirect("/l3/login?next=" + quote(safe_next(self.headers.get("X-Forwarded-Uri")), safe=""))
        elif url.path == "/l3/login":
            error = ERRORS.get(query.get("error", [""])[0], "")
            page = (HERE / "login.html").read_text(encoding="utf-8")
            page = page.replace("{{next}}", html.escape(safe_next(query.get("next", ["/"])[0])))
            page = page.replace("{{error}}", html.escape(error)).replace("{{error_hidden}}", "" if error else "hidden")
            body = page.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == "/l3/logout":
            self.redirect("/l3/login", f"{COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax")
        elif url.path.startswith("/l3/") and url.path[4:] in ASSETS:
            body = (HERE / url.path[4:]).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ASSETS[url.path[4:]])
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def do_POST(self):
        if urlsplit(self.path).path != "/l3/login":
            return self.send_error(404)
        length = min(int(self.headers.get("Content-Length") or 0), 4096)
        form = parse_qs(self.rfile.read(length).decode("utf-8", "replace"))
        target = safe_next(form.get("next", ["/"])[0])
        back = "/l3/login?next=" + quote(target, safe="") + "&error="
        now = time.time()
        failures[:] = [t for t in failures if now - t < 60]
        if len(failures) >= 10:
            return self.redirect(back + "2")
        user_ok = hmac.compare_digest(form.get("username", [""])[0].encode(), USER.encode())
        pass_ok = hmac.compare_digest(form.get("password", [""])[0].encode(), PASSWORD.encode())
        if not (user_ok and pass_ok):
            failures.append(now)
            time.sleep(1)
            return self.redirect(back + "1")
        expires = str(int(now) + SESSION_SECONDS)
        cookie = f"{COOKIE}={expires}.{sign(expires)}; Path=/; Max-Age={SESSION_SECONDS}; Secure; HttpOnly; SameSite=Lax"
        self.redirect(target, cookie)

    def log_message(self, fmt, *args):
        pass  # request lines would include login query strings


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("L3_PORT", "9091"))), Handler).serve_forever()
