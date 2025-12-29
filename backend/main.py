import os
import asyncio
import json
from typing import List, Dict, Optional

# --- 必要なライブラリをまとめてインポート ---
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel
import httpx 
import google.generativeai as genai
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)

# --- DB関連関数のインポート ---
from db import create_session, save_transcript, save_advice, verify_user, get_session_transcripts, update_session_summary, delete_session, get_subordinates, create_subordinate

load_dotenv()

app = FastAPI()

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API Clients Setup ---
deepgram_client = DeepgramClient(os.getenv("DEEPGRAM_API_KEY"))
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel('gemini-2.0-flash')

# --- Connection Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.transcripts: Dict[str, list] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
            self.transcripts[session_id] = []
        self.active_connections[session_id].append(websocket)
        print(f"Client connected: {session_id}")

    def disconnect(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            
            # 接続が0になったらメモリからデータを消去（メモリリーク防止）
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]
                if session_id in self.transcripts:
                    del self.transcripts[session_id]
                print(f"Session {session_id} cleanup complete.")

    async def broadcast(self, message: dict, session_id: str):
        if session_id in self.active_connections:
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

    def add_transcript(self, session_id: str, text: str, speaker: int):
        if session_id not in self.transcripts:
            self.transcripts[session_id] = []
        self.transcripts[session_id].append({"speaker": speaker, "text": text})

    def get_recent_context(self, session_id: str, limit: int = 20):
        return self.transcripts.get(session_id, [])[-limit:]

manager = ConnectionManager()

# --- Core Logic ---

async def generate_advice(session_id: str, db_session_id: str = None):
    """Geminiを使ってアドバイスを生成"""
    context = manager.get_recent_context(session_id)
    if not context: return

    conversation_text = "\n".join([f"Speaker {item['speaker']}: {item['text']}" for item in context])
    prompt = f"""
    あなたは1on1ミーティングのコーチです。以下の会話ログを分析し、
    メンター（Speaker 0と仮定）に対して、次にすべき質問や、フィードバックのアドバイスを1文で出力してください。
    
    会話ログ:
    {conversation_text}
    """
    
    try:
        response = await gemini_model.generate_content_async(prompt)
        advice_text = response.text.strip()
        
        await manager.broadcast({
            "type": "advice",
            "content": advice_text
        }, session_id)

        # ★DB保存
        if db_session_id:
            try:
                save_advice(db_session_id, advice_text)
                print(f"Saved advice to DB: {db_session_id}")
            except Exception as e:
                print(f"DB Error (Advice): {e}")

    except Exception as e:
        print(f"Gemini Error: {e}")


async def process_audio(
    websocket_in: WebSocket, 
    session_id: str, 
    db_session_id: str, # ★ここは必須引数として定義済み
    is_raw_audio: bool = False
):
    try:
        dg_connection = deepgram_client.listen.asyncwebsocket.v("1")

        async def on_message(self, result, **kwargs):
            sentence = result.channel.alternatives[0].transcript
            if len(sentence) == 0: return
            
            words = result.channel.alternatives[0].words
            speaker = words[0].speaker if words else 0
            
            manager.add_transcript(session_id, sentence, speaker)
            await manager.broadcast({
                "type": "transcript",
                "text": sentence,
                "speaker": speaker
            }, session_id)

            # ★DB保存 (引数のdb_session_idを使用)
            if db_session_id:
                try:
                    save_transcript(db_session_id, sentence, speaker)
                except Exception as e:
                    print(f"DB Error: {e}")
            
            asyncio.create_task(generate_advice(session_id, db_session_id))

        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)

        options = LiveOptions(
            model="nova-2",
            language="ja",
            smart_format=True,
            diarize=True,
        )
        
        if is_raw_audio:
            options.encoding = "linear16"
            options.sample_rate = 16000
            options.channels = 1

        if await dg_connection.start(options) is False:
            print("Failed to start Deepgram connection")
            return

        print(f"Deepgram Live connected for session: {session_id}")

        try:
            while True:
                message = await websocket_in.receive()
                if "bytes" in message and message["bytes"]:
                    await dg_connection.send(message["bytes"])
                elif "text" in message:
                    pass
                elif message["type"] == "websocket.disconnect":
                    print("Client disconnected")
                    break
        except WebSocketDisconnect:
            print(f"WebSocket disconnected: {session_id}")
        finally:
            await dg_connection.finish()

    except Exception as e:
        print(f"Process Audio Critical Error: {e}")


# --- Endpoints (ここが大きく変わりました) ---

@app.delete("/sessions/{session_id}")
async def delete_session_endpoint(
    session_id: str,
    authorization: str = Header(None)
):
    """指定されたセッションを削除する"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No token provided")
    
    token = authorization.replace("Bearer ", "")
    user_info = verify_user(token)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        delete_session(session_id, user_info["id"])
        return {"status": "ok", "message": "Session deleted"}
    except Exception as e:
        print(f"Delete Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class CreateSubordinateRequest(BaseModel):
    name: str
    department: Optional[str] = None

@app.get("/subordinates")
async def get_subordinates_endpoint(authorization: str = Header(None)):
    """部下リストを取得"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No token provided")
    
    token = authorization.replace("Bearer ", "")
    user_info = verify_user(token)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        data = get_subordinates(user_info["id"])
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/subordinates")
async def create_subordinate_endpoint(
    request: CreateSubordinateRequest,
    authorization: str = Header(None)
):
    """部下を新規登録"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No token provided")
    
    token = authorization.replace("Bearer ", "")
    user_info = verify_user(token)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        new_sub = create_subordinate(
            user_info["id"], 
            user_info["organization_id"], 
            request.name, 
            request.department
        )
        return new_sub
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SummarizeRequest(BaseModel):
    db_session_id: str

@app.post("/summarize")
async def summarize_session(
    request: SummarizeRequest,
    authorization: str = Header(None)
):
    """会議終了後に要約とネクストアクションを生成して保存する"""
    if not authorization:
        raise HTTPException(status_code=401, detail="No token provided")
    
    # 認証
    token = authorization.replace("Bearer ", "")
    user_info = verify_user(token)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid token")

    # 1. ログ取得
    transcripts = get_session_transcripts(request.db_session_id)
    if not transcripts:
        return {"summary": "会話データがありませんでした。"}

    # 2. プロンプト作成
    conversation_text = "\n".join([f"Speaker {t['speaker']}: {t['content']}" for t in transcripts])
    
    prompt = f"""
    以下の1on1ミーティングの会話ログを分析し、Markdown形式で要約を作成してください。
    
    ## フォーマット
    **【会議の要約】**
    (ここに200文字程度の要約)

    **【決定事項・ネクストアクション】**
    - (アクション1)
    - (アクション2)

    ## 会話ログ
    {conversation_text}
    """

    # 3. Geminiで生成
    try:
        response = await gemini_model.generate_content_async(prompt)
        summary_text = response.text.strip()
        
        # 4. DB保存
        update_session_summary(request.db_session_id, summary_text)
        
        return {"summary": summary_text}
        
    except Exception as e:
        print(f"Summarize Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class JoinMeetingRequest(BaseModel):
    meeting_url: str
    session_id: str
    bot_name: str = "AI 1on1 Coach"

# 1. Bot派遣リクエスト (HTTP)
@app.post("/join-meeting")
async def join_meeting(
    request: JoinMeetingRequest,
    authorization: str = Header(None) # ★ヘッダーからトークン取得
):
    # --- 認証処理 ---
    if not authorization:
        raise HTTPException(status_code=401, detail="No token provided")
    
    token = authorization.replace("Bearer ", "")
    user_info = verify_user(token)
    
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid token")
    # ----------------

    api_key = os.getenv("MEETING_BAAS_API_KEY")
    public_url = os.getenv("PUBLIC_URL")
    
    if not api_key or not public_url:
        return {"error": "Config missing"}

    # ★Bot派遣前にDBセッションを作成
    try:
        db_session_id = create_session(
            user_info["id"], 
            user_info["organization_id"], 
            mode="bot"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB Error: {e}")

    wss_url = public_url.replace("https://", "wss://").replace("http://", "ws://")
    
    # ★URLパラメータに db_session_id を付与してBotに教える
    output_url = f"{wss_url}/ws/meeting-baas/{request.session_id}?db_session_id={db_session_id}"
    
    # ★DEBUG: Botに渡すURLを確認
    print(f"DEBUG: Spawning bot to {request.meeting_url}")
    print(f"DEBUG: Output WebSocket URL: {output_url}")

    payload = {
        "meeting_url": request.meeting_url,
        "bot_name": request.bot_name,
        "streaming": {
            "audio_frequency": "16khz",
            "output": output_url
        }
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                "https://api.meetingbaas.com/bots",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-meeting-baas-api-key": api_key
                },
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
            # ★作成したDBセッションIDをFrontendに返す
            data["db_session_id"] = db_session_id
            return data
        except Exception as e:
            print(f"Error: {e}")
            return {"error": str(e)}

# 2. Bot受信用 (WebSocket)
@app.websocket("/ws/meeting-baas/{session_id}")
async def ws_meeting_baas(
    websocket: WebSocket, 
    session_id: str,
    db_session_id: str = Query(None) # ★URLパラメータからIDを受け取る
):
    # ★DEBUG: Botからの接続を確認
    print(f"DEBUG: Bot connecting to WS for session: {session_id}")
    
    await websocket.accept()
    
    if not db_session_id:
        print("Error: No db_session_id provided from Bot")
        await websocket.close()
        return

    # 受け取ったIDを使って処理開始
    await process_audio(websocket, session_id, db_session_id, is_raw_audio=True)

# 3. マイク/クライアント用 (WebSocket)
@app.websocket("/ws/client/{session_id}")
async def ws_client(
    websocket: WebSocket, 
    session_id: str,
    token: str = Query(...), # ★URLパラメータからトークンを受け取る
    client_mode: str = Query("mic") # ★モードを受け取る (デフォルトはmic)
):
    # --- 認証処理 ---
    user_info = verify_user(token)
    if not user_info:
        print("Authentication failed")
        await websocket.close(code=4001)
        return
    # ----------------

    await manager.connect(websocket, session_id)

    try:
        if client_mode == "mic":
            # ★マイクモードの時のみDBセッションを作成
            db_session_id = create_session(
                user_info["id"], 
                user_info["organization_id"], 
                mode="mic"
            )

            # FrontendにDBのセッションIDを通知する
            await websocket.send_json({
                "type": "db_session_id",
                "id": db_session_id
            })
            
            # 音声処理を開始
            await process_audio(websocket, session_id, db_session_id, is_raw_audio=False)
        else:
            # 視聴モード（Web会議Bot使用時など）：DB作成はせず、接続維持のみ行う
            try:
                while True:
                    await websocket.receive_text()
            except WebSocketDisconnect:
                pass

    except Exception as e:
        print(f"Error in ws_client: {e}")
        await websocket.close()
    finally:
        manager.disconnect(websocket, session_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)