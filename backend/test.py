#!/usr/bin/env python3
"""
Simple test script to verify Python environment
"""
import sys
import os

print("Python version:", sys.version)
print("Current directory:", os.getcwd())
print("Python executable:", sys.executable)

# Check if we can import required packages
try:
    import fastapi
    print("FastAPI available")
except ImportError:
    print("FastAPI not installed")

try:
    import uvicorn
    print("Uvicorn available")
except ImportError:
    print("Uvicorn not installed")

print("Test completed successfully!")