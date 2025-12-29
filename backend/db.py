import os
from supabase import create_client, Client
from dotenv import load_dotenv
from gotrue.errors import AuthApiError

load_dotenv()

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_SERVICE_KEY")

if not url or not key:
    raise ValueError("Supabase credentials not found in .env")

# サービスロールキー（神の権限）でクライアント作成
supabase: Client = create_client(url, key)

def verify_user(token: str):
    """
    Frontendから送られたJWTトークンを検証し、ユーザー情報(ID, OrgID)を返す
    """
    try:
        # Supabase Authでトークンを検証してユーザー情報を取得
        user_response = supabase.auth.get_user(token)
        user = user_response.user
        
        if not user:
            return None

        # profilesテーブルから organization_id を取得
        profile = supabase.table("profiles").select("organization_id").eq("id", user.id).single().execute()
        
        if not profile.data:
            return None
            
        return {
            "id": user.id,
            "organization_id": profile.data["organization_id"]
        }

    except Exception as e:
        print(f"Auth Error: {e}")
        return None

def create_session(user_id: str, organization_id: str, mode: str = "mic"):
    """新しい会議セッションを作成してIDを返す"""
    data = {
        "user_id": user_id,
        "organization_id": organization_id,
        "mode": mode,
        "title": "無題の会議", # 後でAIに要約させる
    }
    response = supabase.table("sessions").insert(data).execute()
    return response.data[0]["id"]

def save_transcript(session_id: str, text: str, speaker: int, timestamp: float = 0.0):
    """字幕を保存"""
    data = {
        "session_id": session_id,
        "speaker": speaker,
        "content": text,
        "timestamp": timestamp
    }
    supabase.table("transcripts").insert(data).execute()

def save_advice(session_id: str, content: str):
    """アドバイスを保存"""
    data = {
        "session_id": session_id,
        "content": content
    }
    supabase.table("advices").insert(data).execute()

def get_session_transcripts(session_id: str):
    """指定されたセッションの全会話ログを取得"""
    response = supabase.table("transcripts") \
        .select("*") \
        .eq("session_id", session_id) \
        .order("timestamp", desc=False) \
        .execute()
    return response.data

def update_session_summary(session_id: str, summary_text: str):
    """セッションのsummaryカラムを更新"""
    supabase.table("sessions") \
        .update({"summary": summary_text}) \
        .eq("id", session_id) \
        .execute()

def delete_session(session_id: str, user_id: str):
    """指定されたセッションを削除 (所有者確認付き)"""
    supabase.table("sessions").delete().eq("id", session_id).eq("user_id", user_id).execute()