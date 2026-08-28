import datetime
import os
import config

_db_instance = None

def get_db():
    """
    Initializes and returns a Firestore Client instance.
    Supports:
    1. Local / Colab Service Account Key JSON
    2. Colab Google Cloud Native Authentication (auth.authenticate_user())
    """
    global _db_instance
    if _db_instance is not None:
        return _db_instance

    # Method 1: Check for service account JSON file
    if os.path.exists(config.SERVICE_ACCOUNT_KEY_PATH):
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not firebase_admin._apps:
            cred = credentials.Certificate(config.SERVICE_ACCOUNT_KEY_PATH)
            firebase_admin.initialize_app(cred)
        _db_instance = firestore.client()
        return _db_instance

    # Method 2: Google Cloud Firestore client (Works with Colab auth.authenticate_user())
    try:
        from google.cloud import firestore
        _db_instance = firestore.Client(project=config.FIREBASE_PROJECT_ID)
        return _db_instance
    except Exception as e:
        raise RuntimeError(
            f"Failed to initialize Firestore connection. Ensure either '{config.SERVICE_ACCOUNT_KEY_PATH}' "
            f"exists or run `auth.authenticate_user()` in Google Colab. Error: {e}"
        )


def delete_non_rajasthan_gk():
    """
    Deletes all questions from Firestore where category is not 'Rajasthan GK'.
    """
    db = get_db()
    collection_ref = db.collection(config.COLLECTION_NAME)
    docs = collection_ref.stream()
    batch = db.batch()
    count = 0
    total_deleted = 0

    for doc in docs:
        data = doc.to_dict()
        cat = (data.get("category") or "").strip().lower()
        if cat != "rajasthan gk":
            batch.delete(doc.reference)
            count += 1
            total_deleted += 1
            if count >= 400:
                batch.commit()
                batch = db.batch()
                count = 0

    if count > 0:
        batch.commit()
    return total_deleted


def get_categories():
    """
    Returns a dictionary of categories and the count of UNUSED questions in each.
    """
    db = get_db()
    collection_ref = db.collection(config.COLLECTION_NAME)
    docs = collection_ref.where("is_used", "==", False).stream()

    category_counts = {}
    for doc in docs:
        data = doc.to_dict()
        cat = data.get("category", "Rajasthan GK")
        if cat.strip().lower() == "rajasthan gk":
            category_counts["Rajasthan GK"] = category_counts.get("Rajasthan GK", 0) + 1

    return category_counts


def get_unused_questions(category: str, limit: int = 5):
    """
    Fetches up to `limit` unused questions for a given category.
    Returns a list of dicts with document ID and question data.
    """
    db = get_db()
    collection_ref = db.collection(config.COLLECTION_NAME)
    
    query = (
        collection_ref
        .where("category", "==", category)
        .where("is_used", "==", False)
        .limit(limit)
    )
    
    docs = query.stream()
    questions = []
    for doc in docs:
        q_data = doc.to_dict()
        q_data["id"] = doc.id
        questions.append(q_data)
        
    return questions


def mark_questions_as_used(question_ids: list):
    """
    Marks the specified question IDs as used in Firestore so they are never repeated.
    """
    if not question_ids:
        return
        
    db = get_db()
    now = datetime.datetime.utcnow()
    
    # Firestore supports batch updates for efficiency
    batch = db.batch()
    for q_id in question_ids:
        doc_ref = db.collection(config.COLLECTION_NAME).document(q_id)
        batch.update(doc_ref, {
            "is_used": True,
            "posted_at": now
        })
    batch.commit()


def add_questions_batch(questions_list: list):
    """
    Uploads a list of question dicts into Firestore.
    """
    db = get_db()
    collection_ref = db.collection(config.COLLECTION_NAME)
    added_count = 0
    
    for q in questions_list:
        doc_data = {
            "category": q.get("category", "Rajasthan GK"),
            "subcategory": q.get("subcategory", "Culture"),
            "topic": q.get("topic", q.get("source_test", "General")),
            "question_text": q.get("question_text", ""),
            "options": q.get("options", []),
            "correct_option_id": int(q.get("correct_option_id", 0)),
            "explanation": q.get("explanation", ""),
            "is_used": False,
            "created_at": datetime.datetime.utcnow(),
            "source_test": q.get("source_test", q.get("topic", ""))
        }
        collection_ref.add(doc_data)
        added_count += 1
        
    return added_count


def get_database_stats():
    """
    Returns total, used, and unused question statistics.
    """
    db = get_db()
    collection_ref = db.collection(config.COLLECTION_NAME)
    docs = collection_ref.stream()
    
    total = 0
    used = 0
    unused = 0
    categories = {}
    
    for doc in docs:
        data = doc.to_dict()
        total += 1
        cat = data.get("category", "General")
        is_used = data.get("is_used", False)
        
        if is_used:
            used += 1
        else:
            unused += 1
            categories[cat] = categories.get(cat, 0) + 1
            
    return {
        "total": total,
        "used": used,
        "unused": unused,
        "categories_unused": categories
    }


def reset_all_questions():
    """
    Resets all questions to is_used: False (Useful for testing).
    """
    db = get_db()
    docs = db.collection(config.COLLECTION_NAME).stream()
    batch = db.batch()
    count = 0
    
    for doc in docs:
        batch.update(doc.reference, {"is_used": False, "posted_at": None})
        count += 1
        
    batch.commit()
    return count


# ==============================================================================
# READY-MADE QUIZ SYSTEM (NEW ADDITIVE FUNCTIONS)
# ==============================================================================

def create_quiz(title: str, category: str, subcategory: str, question_ids: list) -> str:
    """
    Creates a new ready-made quiz set in the 'quizzes' collection.
    """
    db = get_db()
    now_iso = datetime.datetime.utcnow().isoformat()
    quiz_data = {
        "title": title.strip() if title else "Untitled Quiz",
        "category": (category or "General").strip(),
        "subcategory": (subcategory or "General").strip(),
        "questionIds": list(question_ids or []),
        "createdAt": now_iso,
        "updatedAt": now_iso
    }
    _, doc_ref = db.collection("quizzes").add(quiz_data)
    return doc_ref.id


def get_all_quizzes() -> list:
    """
    Returns all ready-made quizzes from the 'quizzes' collection.
    """
    db = get_db()
    docs = db.collection("quizzes").stream()
    quizzes = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        quizzes.append(data)
    quizzes.sort(key=lambda q: q.get("createdAt", ""), reverse=True)
    return quizzes


def get_quiz(quiz_id: str) -> dict:
    """
    Fetches a quiz by ID and resolves each question doc from the questions collection.
    """
    db = get_db()
    doc = db.collection("quizzes").document(quiz_id).get()
    if not doc.exists:
        return None
    quiz_data = doc.to_dict()
    quiz_data["id"] = doc.id
    question_ids = quiz_data.get("questionIds", [])
    
    questions = []
    questions_ref = db.collection(config.COLLECTION_NAME)
    for qid in question_ids:
        q_doc = questions_ref.document(qid).get()
        if q_doc.exists:
            q_dict = q_doc.to_dict()
            q_dict["id"] = q_doc.id
            questions.append(q_dict)
    quiz_data["questions"] = questions
    return quiz_data


def delete_quiz(quiz_id: str):
    """
    Deletes a ready-made quiz doc by ID.
    """
    db = get_db()
    db.collection("quizzes").document(quiz_id).delete()


def create_quiz_session(quiz_id: str, quiz_title: str, channel_id: str, channel_name: str) -> str:
    """
    Creates a new quiz session doc for tracking broadcast polls.
    """
    db = get_db()
    now_iso = datetime.datetime.utcnow().isoformat()
    session_data = {
        "quizId": quiz_id,
        "quizTitle": quiz_title,
        "channelId": str(channel_id),
        "channelName": channel_name,
        "startedAt": now_iso,
        "status": "active",
        "questions": [],
        "pollIds": []
    }
    _, doc_ref = db.collection("quiz_sessions").add(session_data)
    return doc_ref.id


def add_session_question(session_id: str, question_id: str, poll_id: str, telegram_message_id: int, correct_option_id: int, question_text: str):
    """
    Appends sent question and poll metadata to the active quiz session.
    """
    db = get_db()
    session_ref = db.collection("quiz_sessions").document(session_id)
    now_iso = datetime.datetime.utcnow().isoformat()
    q_entry = {
        "questionId": question_id,
        "pollId": str(poll_id),
        "telegramMessageId": telegram_message_id,
        "correctOptionId": int(correct_option_id),
        "questionText": str(question_text or ""),
        "sentAt": now_iso
    }
    doc = session_ref.get()
    if doc.exists:
        data = doc.to_dict()
        questions = data.get("questions", [])
        questions.append(q_entry)
        poll_ids = data.get("pollIds", [])
        poll_ids.append(str(poll_id))
        session_ref.update({"questions": questions, "pollIds": poll_ids})


def get_session_by_poll_id(poll_id: str) -> tuple:
    """
    Finds (session_id, question_data) for a given poll_id.
    MUST return (None, None) gracefully for unrecognized polls (e.g. from existing dispatch system).
    """
    if not poll_id:
        return (None, None)
    try:
        db = get_db()
        target_poll_str = str(poll_id)
        
        # 1. Direct query by pollIds array
        sessions_ref = db.collection("quiz_sessions")
        query = sessions_ref.where("pollIds", "array_contains", target_poll_str).limit(1)
        docs = list(query.stream())
        
        if docs:
            session_doc = docs[0]
            session_id = session_doc.id
            session_data = session_doc.to_dict()
            for q in session_data.get("questions", []):
                if str(q.get("pollId")) == target_poll_str:
                    return (session_id, q)
            return (session_id, None)

        # 2. Fallback scan on active sessions
        active_docs = sessions_ref.where("status", "==", "active").stream()
        for s_doc in active_docs:
            s_data = s_doc.to_dict()
            for q in s_data.get("questions", []):
                if str(q.get("pollId")) == target_poll_str:
                    return (s_doc.id, q)

        return (None, None)
    except Exception:
        return (None, None)


def record_quiz_response(session_id: str, poll_id: str, user_id, user_name: str, selected_option_id: int, is_correct: bool, response_time_ms: int):
    """
    Records a participant answer into the 'quiz_responses' collection.
    """
    try:
        db = get_db()
        now_iso = datetime.datetime.utcnow().isoformat()
        resp_data = {
            "sessionId": session_id,
            "pollId": str(poll_id),
            "userId": str(user_id),
            "userName": user_name or "Anonymous",
            "selectedOptionId": int(selected_option_id),
            "isCorrect": bool(is_correct),
            "answeredAt": now_iso,
            "responseTimeMs": max(0, int(response_time_ms or 0))
        }
        db.collection("quiz_responses").add(resp_data)
    except Exception as e:
        print(f"Error recording quiz response: {e}")


def get_leaderboard(session_id: str) -> list:
    """
    Aggregates participant responses for a session into a ranked leaderboard.
    Sorted by correctCount desc, avgResponseTimeMs asc.
    """
    try:
        db = get_db()
        docs = db.collection("quiz_responses").where("sessionId", "==", session_id).stream()
        user_stats = {}
        for doc in docs:
            d = doc.to_dict()
            u_id = str(d.get("userId", ""))
            if not u_id:
                continue
            if u_id not in user_stats:
                user_stats[u_id] = {
                    "userId": u_id,
                    "userName": d.get("userName") or "Participant",
                    "correctCount": 0,
                    "totalAnswered": 0,
                    "totalTimeMs": 0
                }
            user_stats[u_id]["totalAnswered"] += 1
            if d.get("isCorrect", False):
                user_stats[u_id]["correctCount"] += 1
            user_stats[u_id]["totalTimeMs"] += max(0, int(d.get("responseTimeMs", 0)))
            if d.get("userName") and user_stats[u_id]["userName"] == "Participant":
                user_stats[u_id]["userName"] = d.get("userName")

        leaderboard = []
        for u_id, st in user_stats.items():
            tot = st["totalAnswered"]
            avg_time = round(st["totalTimeMs"] / tot, 1) if tot > 0 else 0
            leaderboard.append({
                "userId": st["userId"],
                "userName": st["userName"],
                "correctCount": st["correctCount"],
                "totalAnswered": tot,
                "avgResponseTimeMs": avg_time
            })

        # Sort by correctCount desc, avgResponseTimeMs asc
        leaderboard.sort(key=lambda x: (-x["correctCount"], x["avgResponseTimeMs"]))
        return leaderboard
    except Exception as e:
        print(f"Error generating leaderboard: {e}")
        return []


def complete_quiz_session(session_id: str):
    """
    Marks a quiz session as completed.
    """
    db = get_db()
    now_iso = datetime.datetime.utcnow().isoformat()
    db.collection("quiz_sessions").document(session_id).update({
        "status": "completed",
        "completedAt": now_iso
    })

