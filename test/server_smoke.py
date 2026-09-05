#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""server_smoke.py — server.py 冒烟测试

在进程内启动 ThreadingHTTPServer，自连验证：
  1. 静态资源全部 200
  2. 点文件 / 路径穿越（.claude/、.git/、../）全部 404
退出码 0 = 通过。用法：python3 test/server_smoke.py
"""
import http.client
import importlib.util
import os
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("srv", os.path.join(HERE, "..", "server.py"))
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

PORT = 8131
httpd = srv.http.server.ThreadingHTTPServer(("127.0.0.1", PORT), srv.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.3)


def get(path):
    """发送原始路径的 GET 请求（不做客户端归一化）"""
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=3)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, len(body)


failures = 0
for path in ["/", "/js/app.js", "/js/engine.js", "/js/cards.js",
             "/js/evaluator.js", "/css/style.css"]:
    status, size = get(path)
    ok = status == 200 and size > 0
    failures += 0 if ok else 1
    print("  %s GET %-16s → %d (%dB)" % ("✓" if ok else "✗", path, status, size))

for path in ["/.claude/settings.json", "/.git/config",
             "/test/../.claude/settings.json"]:
    status, _ = get(path)
    ok = status == 404
    failures += 0 if ok else 1
    print("  %s GET %-40s → %d（%s）" % ("✓" if ok else "✗", path, status,
                                         "应拦截" if ok else "泄露！"))

# CPython 的 translate_path 先 normpath 再跳过 ".." 分量，无法越出根目录：
# "/../requir.txt" 实际解析为根内 requir.txt（本来就可访问的内容），应 200
status, _ = get("/../requir.txt")
ok = status == 200
failures += 0 if ok else 1
print("  %s GET %-40s → %d（根内文件，应 200）" % ("✓" if ok else "✗",
                                                  "/../requir.txt", status))

httpd.shutdown()
print("")
if failures:
    print("%d 项冒烟检查失败" % failures)
    raise SystemExit(1)
print("server.py 冒烟检查全部通过")
