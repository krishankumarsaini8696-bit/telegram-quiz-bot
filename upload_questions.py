import json
import os
import database

def upload_from_file(file_path="questions.json"):
    """
    Reads a JSON file containing quiz questions and uploads them to Firestore.
    """
    if not os.path.exists(file_path):
        print(f"❌ File not found: {file_path}")
        return 0

    with open(file_path, "r", encoding="utf-8") as f:
        questions = json.load(f)

    print(f"📖 Loaded {len(questions)} questions from {file_path}...")
    added = database.add_questions_batch(questions)
    print(f"✅ Successfully inserted {added} questions into Firestore!")
    return added

if __name__ == "__main__":
    upload_from_file("questions.json")
    stats = database.get_database_stats()
    print(f"\n📊 Current Database Stats:")
    print(f" - Total Questions: {stats['total']}")
    print(f" - Unused Questions: {stats['unused']}")
    print(f" - Used Questions: {stats['used']}")
    print(f" - Categories (Unused): {stats['categories_unused']}")
