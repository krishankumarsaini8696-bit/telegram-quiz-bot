# 🎯 Telegram Quiz Automation System

Automated Telegram Quiz System powered by **Firebase Firestore** (`telegram-9f787`) and **Google Colab**.

---

## 📁 Project Structure

```
d:/colab/
├── Telegram_Quiz_Automation.ipynb  # Complete Google Colab notebook (All-in-one runner)
├── bot.py                         # Telegram Bot script (handles /postquiz wizard & posting)
├── database.py                    # Firebase Firestore manager (reads/writes unused questions)
├── config.py                      # Credentials configuration
├── upload_questions.py            # Question batch uploader
├── questions.json                 # Question bank JSON file (Science, History, Geography, Tech, GK)
└── README.md                      # Instructions
```

---

## ⚡ How the Quiz Flow Works

1. Send `/postquiz` to your Bot in private chat.
2. **Step 1:** Select a **Category** from interactive buttons (e.g. Science, Geography, History).
3. **Step 2:** Select the **Number of Questions** to post (1, 2, 3, 5, 10).
4. **Step 3:** Select **When to Post** (*Post Now* or *In 5/15/30/60 minutes*).
5. The bot fetches unused questions from Firestore, posts native Telegram Quiz Polls to your channel, and marks the questions as `is_used: True` so they are never repeated!

---

## 🚀 How to Run in Google Colab

1. Open [Google Colab](https://colab.research.google.com/).
2. Click **Upload** and select `Telegram_Quiz_Automation.ipynb`.
3. In **Step 3**, enter your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID`.
4. Run all cells in sequence (`Runtime` → `Run all` or run each cell with Shift+Enter).
5. Open Telegram, start your bot, and send `/postquiz`!
