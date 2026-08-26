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
