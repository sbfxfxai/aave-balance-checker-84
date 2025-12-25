from http.server import BaseHTTPRequestHandler
import os
import json
import time


def _get_square_public_config():
    environment = os.getenv("SQUARE_ENVIRONMENT", "production")

    if environment == "sandbox":
        default_api_base_url = "https://connect.squareupsandbox.com"
    else:
        default_api_base_url = "https://connect.squareup.com"

    application_id = os.getenv("SQUARE_APPLICATION_ID", "")
    location_id = os.getenv("SQUARE_LOCATION_ID", "")
    access_token = os.getenv("SQUARE_ACCESS_TOKEN", "")

    return {
        "application_id": application_id,
        "location_id": location_id,
        "environment": environment,
        "api_base_url": os.getenv("SQUARE_API_BASE_URL", default_api_base_url),
        "has_access_token": bool(access_token),
        "credentials_configured": bool(application_id and location_id and access_token),
        "timestamp": int(time.time()),
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
        self.wfile.write(json.dumps(_get_square_public_config()).encode())
        return
