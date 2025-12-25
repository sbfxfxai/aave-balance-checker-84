from http.server import BaseHTTPRequestHandler
import os
import json
import time

try:
    import requests  # noqa: F401
    requests_available = True
except Exception:
    requests_available = False


def _get_square_health():
    environment = os.getenv("SQUARE_ENVIRONMENT", "production")
    application_id = os.getenv("SQUARE_APPLICATION_ID", "")
    location_id = os.getenv("SQUARE_LOCATION_ID", "")
    access_token = os.getenv("SQUARE_ACCESS_TOKEN", "")

    return {
        "status": "healthy",
        "service": "square-api",
        "timestamp": int(time.time()),
        "environment": environment,
        "application_id": application_id,
        "location_id": location_id,
        "has_access_token": bool(access_token),
        "credentials_configured": bool(application_id and location_id and access_token),
        "requests_available": requests_available,
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(_get_square_health()).encode())
        return
