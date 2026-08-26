import asyncio
import logging
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Poll
)
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes
)

import config
import database

# Configure Logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Temporary in-memory state for user interactions (User ID -> {category, count})
user_sessions = {}


def is_admin(user_id: int) -> bool:
    """Checks if the user is authorized. If ADMIN_USER_IDS is empty, allows all."""
    if not config.ADMIN_USER_IDS:
        return True
    return user_id in config.ADMIN_USER_IDS


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /start command."""
    user = update.effective_user
    welcome_text = (
        f"👋 Hello, **{user.first_name}**!\n\n"
        f"🎯 **Telegram Quiz Automation Bot**\n\n"
        f"Available Commands:\n"
        f"• `/postquiz` - Start the quiz posting wizard\n"
        f"• `/stats` - View questions database stats\n"
        f"• `/help` - Show help and instructions\n"
    )
    keyboard = [
        [InlineKeyboardButton("🚀 Post a Quiz Now", callback_data="start_postquiz")],
        [InlineKeyboardButton("📊 View Database Stats", callback_data="view_stats")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(welcome_text, parse_mode="Markdown", reply_markup=reply_markup)


async def stats_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /stats command."""
    stats = database.get_database_stats()
    text = (
        f"📊 **Database Statistics**\n\n"
        f"• **Total Questions:** `{stats['total']}`\n"
        f"• **Unused (Available):** `{stats['unused']}`\n"
        f"• **Already Used:** `{stats['used']}`\n\n"
        f"📂 **Available Categories & Unused Count:**\n"
    )
    if stats["categories_unused"]:
        for cat, cnt in stats["categories_unused"].items():
            text += f"  - **{cat}:** `{cnt}` questions\n"
    else:
        text += "  _No unused questions available._"

    if update.message:
        await update.message.reply_text(text, parse_mode="Markdown")
    elif update.callback_query:
        await update.callback_query.message.edit_text(text, parse_mode="Markdown")


async def postquiz_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Step 1: /postquiz -> Select Category
    """
    user_id = update.effective_user.id
    if not is_admin(user_id):
        await update.message.reply_text("⛔ You are not authorized to post quizzes.")
        return

    # Fetch categories with unused questions
    cat_counts = database.get_categories()

    if not cat_counts:
        msg = (
            "⚠️ **No unused questions found in the database!**\n\n"
            "Please upload new questions or reset existing ones."
        )
        if update.message:
            await update.message.reply_text(msg, parse_mode="Markdown")
        elif update.callback_query:
            await update.callback_query.message.edit_text(msg, parse_mode="Markdown")
        return

    # Build Category selection inline keyboard
    keyboard = []
    for cat, count in cat_counts.items():
        button_text = f"📚 {cat} ({count} available)"
        keyboard.append([InlineKeyboardButton(button_text, callback_data=f"cat:{cat}")])

    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="cancel_wizard")])
    reply_markup = InlineKeyboardMarkup(keyboard)

    prompt_text = "🎯 **Step 1/3: Select a Quiz Category**\n\nChoose the topic for the quiz:"
    if update.message:
        await update.message.reply_text(prompt_text, parse_mode="Markdown", reply_markup=reply_markup)
    elif update.callback_query:
        await update.callback_query.message.edit_text(prompt_text, parse_mode="Markdown", reply_markup=reply_markup)


async def handle_callback_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handles inline keyboard button presses for the quiz wizard.
    """
    query = update.callback_query
    await query.answer()
    data = query.data
    user_id = query.from_user.id

    if not is_admin(user_id):
        await query.edit_message_text("⛔ Unauthorized access.")
        return

    # Cancel action
    if data == "cancel_wizard":
        user_sessions.pop(user_id, None)
        await query.edit_message_text("❌ Quiz posting cancelled.")
        return

    if data == "start_postquiz":
        await postquiz_command(update, context)
        return

    if data == "view_stats":
        await stats_command(update, context)
        return

    # Step 2: Category Selected -> Ask for Question Count
    if data.startswith("cat:"):
        selected_category = data.split("cat:", 1)[1]
        cat_counts = database.get_categories()
        available_count = cat_counts.get(selected_category, 0)

        if available_count == 0:
            await query.edit_message_text(
                f"⚠️ No unused questions left in **{selected_category}**. Please select another category.",
                parse_mode="Markdown"
            )
            return

        # Save category in session
        user_sessions[user_id] = {"category": selected_category, "available": available_count}

        # Build options for question count (e.g. 1, 2, 3, 5, 10 up to available)
        count_options = [1, 2, 3, 5, 10]
        count_options = [c for c in count_options if c <= available_count]
        if available_count not in count_options:
            count_options.append(available_count)
            count_options.sort()

        keyboard = []
        row = []
        for c in count_options:
            row.append(InlineKeyboardButton(f"{c} Question{'s' if c > 1 else ''}", callback_data=f"cnt:{c}"))
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)

        keyboard.append([InlineKeyboardButton("🔙 Back to Categories", callback_data="start_postquiz")])
        reply_markup = InlineKeyboardMarkup(keyboard)

        prompt_text = (
            f"🎯 **Step 2/3: Number of Questions**\n\n"
            f"Category: **{selected_category}** (Available: `{available_count}`)\n\n"
            f"How many questions would you like to post?"
        )
        await query.edit_message_text(prompt_text, parse_mode="Markdown", reply_markup=reply_markup)
        return

    # Step 3: Question Count Selected -> Ask When to Post
    if data.startswith("cnt:"):
        count = int(data.split("cnt:", 1)[1])
        if user_id not in user_sessions:
            await query.edit_message_text("⚠️ Session expired. Please start again with /postquiz.")
            return

        user_sessions[user_id]["count"] = count
        selected_category = user_sessions[user_id]["category"]

        keyboard = [
            [InlineKeyboardButton("🚀 Post Immediately (Now)", callback_data="time:0")],
            [
                InlineKeyboardButton("⏱ In 5 Mins", callback_data="time:5"),
                InlineKeyboardButton("⏱ In 15 Mins", callback_data="time:15")
            ],
            [
                InlineKeyboardButton("⏱ In 30 Mins", callback_data="time:30"),
                InlineKeyboardButton("⏱ In 1 Hour", callback_data="time:60")
            ],
            [InlineKeyboardButton("❌ Cancel", callback_data="cancel_wizard")]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        prompt_text = (
            f"🎯 **Step 3/3: Schedule Quiz Posting**\n\n"
            f"• Category: **{selected_category}**\n"
            f"• Number of Questions: **{count}**\n"
            f"• Destination Channel: `{config.TELEGRAM_CHANNEL_ID}`\n\n"
            f"When would you like to post this quiz?"
        )
        await query.edit_message_text(prompt_text, parse_mode="Markdown", reply_markup=reply_markup)
        return

    # Step 4: Time Selected -> Post Quiz (Immediate or Delayed)
    if data.startswith("time:"):
        delay_minutes = int(data.split("time:", 1)[1])
        if user_id not in user_sessions:
            await query.edit_message_text("⚠️ Session expired. Please start again with /postquiz.")
            return

        session = user_sessions.pop(user_id)
        category = session["category"]
        count = session["count"]

        if delay_minutes == 0:
            await query.edit_message_text(
                f"⏳ Fetching `{count}` questions from **{category}** and sending to `{config.TELEGRAM_CHANNEL_ID}`...",
                parse_mode="Markdown"
            )
            asyncio.create_task(publish_quiz_to_channel(context.bot, query.message.chat_id, category, count))
        else:
            await query.edit_message_text(
                f"⏰ **Quiz Scheduled!**\n\n"
                f"• Category: **{category}**\n"
                f"• Questions: **{count}**\n"
                f"• Scheduled in: **{delay_minutes} minutes**\n"
                f"• Channel: `{config.TELEGRAM_CHANNEL_ID}`\n\n"
                f"I will post them automatically when the time comes! 🚀",
                parse_mode="Markdown"
            )
            asyncio.create_task(
                delayed_publish_task(context.bot, query.message.chat_id, category, count, delay_minutes)
            )


async def delayed_publish_task(bot, admin_chat_id: int, category: str, count: int, delay_minutes: int):
    """Waits for specified minutes and then posts quiz polls."""
    await asyncio.sleep(delay_minutes * 60)
    await publish_quiz_to_channel(bot, admin_chat_id, category, count)


def format_markdown_table(text: str) -> str:
    """Converts Markdown tables (| col1 | col2 |) into clean readable lists for Telegram polls."""
    if not text or "|" not in text:
        return text or ""
    lines = text.split("\n")
    new_lines = []
    in_table = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped.split("|") if c.strip()]
            if all(c.replace(":", "").replace("-", "") == "" for c in cells):
                continue
            if not in_table:
                in_table = True
                continue
            if len(cells) >= 2:
                new_lines.append(f"{cells[0]} ➔ {cells[1]}")
            elif len(cells) == 1:
                new_lines.append(cells[0])
        else:
            in_table = False
            new_lines.append(line)
    return "\n".join(new_lines).strip()


async def publish_quiz_to_channel(bot, admin_chat_id: int, category: str, count: int):
    """
    Fetches unused questions from Firestore, posts them as native Telegram quiz polls to the channel,
    and marks them as used in Firestore.
    """
    try:
        # Fetch unused questions
        questions = database.get_unused_questions(category=category, limit=count)

        if not questions:
            await bot.send_message(
                chat_id=admin_chat_id,
                text=f"⚠️ No unused questions were found for **{category}** at post time.",
                parse_mode="Markdown"
            )
            return

        posted_ids = []
        for index, q in enumerate(questions, start=1):
            raw_text = str(q.get("question_text", "")).strip()
            formatted_q = format_markdown_table(raw_text)
            has_table_or_multiline = "\n" in formatted_q or "➔" in formatted_q or len(formatted_q) > 120

            raw_options = q.get("options", [])
            clean_options = [str(opt).strip()[:98] for opt in raw_options] if len(raw_options) >= 2 else ["Option A", "Option B"]
            correct_id = int(q.get("correct_option_id", 0))
            raw_expl = str(q.get("explanation", "")).strip()
            explanation = format_markdown_table(raw_expl)[:195] if raw_expl else None

            if has_table_or_multiline:
                # Step 1: Send formatted question as a message with full linebreaks
                msg_text = f"📝 **प्रश्न #{index}:**\n\n{formatted_q}\n\n👇 **सही विकल्प / कूट का चयन करें:**"
                await bot.send_message(
                    chat_id=config.TELEGRAM_CHANNEL_ID,
                    text=msg_text,
                    parse_mode="Markdown"
                )
                await asyncio.sleep(0.8)

                # Step 2: Send Quiz Poll for voting
                await bot.send_poll(
                    chat_id=config.TELEGRAM_CHANNEL_ID,
                    question=f"प्रश्न #{index} का सही उत्तर चुनें:",
                    options=clean_options,
                    type=Poll.QUIZ,
                    correct_option_id=correct_id,
                    explanation=explanation,
                    is_anonymous=True
                )
            else:
                # Standard single-line question
                await bot.send_poll(
                    chat_id=config.TELEGRAM_CHANNEL_ID,
                    question=formatted_q[:295],
                    options=clean_options,
                    type=Poll.QUIZ,
                    correct_option_id=correct_id,
                    explanation=explanation,
                    is_anonymous=True
                )

            posted_ids.append(q["id"])
            await asyncio.sleep(1.5)

        # Mark questions as used in Firestore
        database.mark_questions_as_used(posted_ids)

        # Confirm to admin
        await bot.send_message(
            chat_id=admin_chat_id,
            text=(
                f"✅ **Successfully posted {len(posted_ids)} quiz question(s) to `{config.TELEGRAM_CHANNEL_ID}`!**\n\n"
                f"• Category: **{category}**\n"
                f"• Questions have been marked as used in Firestore. 🎯"
            ),
            parse_mode="Markdown"
        )
    except Exception as e:
        logger.error(f"Error publishing quiz: {e}")
        await bot.send_message(
            chat_id=admin_chat_id,
            text=f"❌ **Error posting quiz to channel:** `{e}`\n\nPlease check bot channel admin permissions.",
            parse_mode="Markdown"
        )


def main():
    """Initializes and starts the Telegram Bot."""
    if not config.TELEGRAM_BOT_TOKEN:
        print("❌ Error: TELEGRAM_BOT_TOKEN is not configured in config.py!")
        return

    print("🚀 Initializing Telegram Quiz Automation Bot...")
    app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()

    # Handlers
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("postquiz", postquiz_command))
    app.add_handler(CommandHandler("stats", stats_command))
    app.add_handler(CallbackQueryHandler(handle_callback_query))

    print(f"✅ Bot is running! Open your Telegram and send /postquiz to your bot.")
    app.run_polling()


if __name__ == "__main__":
    main()
