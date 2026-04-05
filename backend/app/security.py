# Import bleach library for HTML sanitization to prevent XSS attacks
import bleach

# Define allowed HTML tags (none for security)
ALLOWED_TAGS = []
# Define allowed HTML attributes (none for security)
ALLOWED_ATTRIBUTES = {}

# Function to sanitize text input by removing HTML and scripts
def sanitize_text(value: str) -> str:
    # If value is None, return empty string
    if value is None:
        return ""
    # Clean the text using bleach with no allowed tags/attributes, strip whitespace
    cleaned = bleach.clean(value, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, strip=True)
    # Return the stripped cleaned text
    return cleaned.strip()

# Function to sanitize a dictionary payload
def sanitize_payload(payload: dict) -> dict:
    # Initialize sanitized dictionary
    sanitized = {}
    # Iterate over each key-value pair in the payload
    for key, value in payload.items():
        # If value is a string, sanitize it
        if isinstance(value, str):
            sanitized[key] = sanitize_text(value)
        # Otherwise, keep the value as is
        else:
            sanitized[key] = value
    # Return the sanitized payload
    return sanitized
