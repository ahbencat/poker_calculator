#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""server.py — 静态托管服务器（Python 标准库，零依赖）

用法：
  python3 server.py [端口] [绑定地址]
  默认：python3 server.py 8000 0.0.0.0

绑定 0.0.0.0 即对局域网开放（对外提供服务）；同一网络下的手机浏览器
可直接访问打印出的局域网地址。胜率计算在访问者浏览器本地完成，
服务器只负责传输静态文件，无计算负载。

安全：拒绝所有点文件/点目录（.claude/、.git/ 等隐藏内容）的访问。
"""
import http.server
import os
import socket
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8000
DEFAULT_HOST = "0.0.0.0"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")  # 文件更新即时生效
        super().end_headers()

    def send_head(self):
        # 屏蔽点文件/点目录，防止 .claude/ 等敏感内容外泄。
        # translate_path 已丢弃 ".." 分量，此处只需检查点前缀；
        # 注意 relpath 对根目录自身返回 "."，需排除。
        path = os.path.abspath(self.translate_path(self.path))
        rel = os.path.relpath(path, ROOT)
        parts = [p for p in rel.split(os.sep) if p and p != "."]
        if any(p.startswith(".") for p in parts):
            self.send_error(404, "Not Found")
            return None
        return super().send_head()


def lan_ip():
    """本机局域网 IP（UDP connect 不实际发包，仅确定路由）"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    host = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_HOST
    server = http.server.ThreadingHTTPServer((host, port), Handler)
    print("德州扑克胜率计算器已启动")
    print("  本机访问:   http://127.0.0.1:%d/" % port)
    if host == "0.0.0.0":
        print("  局域网访问: http://%s:%d/  （同一网络下的手机可直接打开）" % (lan_ip(), port))
    print("  Ctrl+C 停止服务")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")


if __name__ == "__main__":
    main()
