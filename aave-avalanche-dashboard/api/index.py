"""
Vercel serverless function entry point for FastAPI app
Uses Mangum adapter to convert FastAPI ASGI app to AWS Lambda/Vercel format
"""
import sys
import os

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mangum import Mangum  # type: ignore
from app.main import app

# Wrap FastAPI app with Mangum adapter for Vercel
handler = Mangum(app, lifespan="off")

