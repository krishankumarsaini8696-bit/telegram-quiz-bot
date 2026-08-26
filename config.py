import os

# ==============================================================================
# Telegram & Firebase Configuration
# ==============================================================================
# In Google Colab, you can either:
# 1. Set these directly below, OR
# 2. Use Google Colab Secrets (the 🔑 key icon on the left sidebar in Colab)
# ==============================================================================

# Your Firebase Project ID
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "telegram-9f787")

# Path to serviceAccountKey.json (if using service account key authentication)
SERVICE_ACCOUNT_KEY_PATH = os.getenv("SERVICE_ACCOUNT_KEY_PATH", "serviceAccountKey.json")

# Your Telegram Bot Token from @BotFather
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8846369362:AAHdB98_mTP74soB5sssbVv_XE5NZMgy72I")

# Your Telegram Channel ID (e.g. "@my_channel" or numeric ID "-1001234567890")
TELEGRAM_CHANNEL_ID = os.getenv("TELEGRAM_CHANNEL_ID", "-1004340852837")

# Admin User IDs who are allowed to trigger /postquiz (optional, leave empty to allow any user who interacts with bot)
ADMIN_USER_IDS = [int(x.strip()) for x in os.getenv("ADMIN_USER_IDS", "").split(",") if x.strip().isdigit()]

# Firestore Collection Name
COLLECTION_NAME = "questions"
