import os
import asyncio
import json
from typing import List, Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)
import google.generativeai as genai

from pydantic import BaseModel # データ構造定義用
import httpx # 外部API通信用

load_dotenv()

app = FastAPI()

# CORS設定 (フロントエンドからのアクセス許可)
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
    """クライアント(Frontend)へのプッシュ通知を管理"""
    def __init__(self):
        # session_idごとに複数のWebSocket接続を管理
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # 会話ログ (簡易メモリ保存)
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
            self.active_connections[session_id].remove(websocket)

    async def broadcast(self, message: dict, session_id: str):
        """指定セッションの全クライアントにデータを送信"""
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

# --- Core Logic: Audio Processing & AI Advice ---

async def generate_advice(session_id: str):
    """Geminiを使ってアドバイスを生成"""
    context = manager.get_recent_context(session_id)
    if not context:
        return

    # プロンプトの構築
    conversation_text = "\n".join([f"Speaker {item['speaker']}: {item['text']}" for item in context])
    prompt = f"""
    あなたは1on1ミーティングのコーチです。以下の会話ログを分析し、
    メンター（Speaker 0と仮定）に対して、次にすべき質問や、フィードバックのアドバイスを1文で出力してください。
    
    会話ログ:
    {conversation_text}
    """
    
    try:
        # 非同期でGemini呼び出し
        response = await gemini_model.generate_content_async(prompt)
        advice_text = response.text.strip()
        
        await manager.broadcast({
            "type": "advice",
            "content": advice_text
        }, session_id)
    except Exception as e:
        print(f"Gemini Error: {e}")

async def process_audio(
    websocket_in: WebSocket, 
    session_id: str, 
    is_raw_audio: bool = False
):
    """
    Meeting Baas対応: シンプルな即時転送版（バッファリングなし）
    """
    try:
        # Deepgram接続
        dg_connection = deepgram_client.listen.asyncwebsocket.v("1")

        # --- 結果受け取り ---
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
            
            asyncio.create_task(generate_advice(session_id))

        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)

        # 設定: シンプルに戻す
        options = LiveOptions(
            model="nova-2",
            language="ja",
            smart_format=True,
            diarize=True,
        )
        
        # Meeting Baas用の16k設定は維持（これがないと動かないため）
        if is_raw_audio:
            options.encoding = "linear16"
            options.sample_rate = 16000
            options.channels = 1

        if await dg_connection.start(options) is False:
            print("Failed to start Deepgram connection")
            return

        print(f"Deepgram Live connected for session: {session_id}")

        # --- 受信ループ（元に戻す: 来たデータを即転送） ---
        try:
            while True:
                message = await websocket_in.receive()

                if "bytes" in message and message["bytes"]:
                    # バッファリングせず、即座に送る
                    await dg_connection.send(message["bytes"])
                
                elif "text" in message:
                    # メタデータは無視
                    pass
                    
                elif message["type"] == "websocket.disconnect":
                    print("Client disconnected")
                    break
        
        except WebSocketDisconnect:
            print(f"WebSocket disconnected: {session_id}")
        except Exception as e:
            print(f"Loop Error: {e}")
        finally:
            await dg_connection.finish()

    except Exception as e:
        print(f"Process Audio Critical Error: {e}")

# --- Endpoints ---

# --- リクエストボディの定義 ---
class JoinMeetingRequest(BaseModel):
    meeting_url: str
    bot_name: str = "AI 1on1 Coach"

# --- Bot呼び出し用エンドポイント ---
@app.post("/join-meeting")
async def join_meeting(request: JoinMeetingRequest):
    """
    Frontendから会議URLを受け取り、Meeting Baas APIを叩いてBotを派遣する
    """
    
    # .envから設定を読み込む
    api_key = os.getenv("MEETING_BAAS_API_KEY")
    public_url = os.getenv("PUBLIC_URL") # ngrokのURL (例: https://xxxx.ngrok-free.app)
    
    if not api_key or not public_url:
        return {"error": "API Key or Public URL is missing in .env"}

    # https -> wss に変換
    wss_url = public_url.replace("https://", "wss://").replace("http://", "ws://")
    # 固定のセッションID (本番では動的に生成推奨)
    session_id = "demo-session-1"
    
    output_url = f"{wss_url}/ws/meeting-baas/{session_id}"

    # Meeting Baas APIへのペイロード
    payload = {
        "meeting_url": request.meeting_url,
        "bot_name": request.bot_name,
        "streaming": {
            "audio_frequency": "16khz",
            "output": output_url
        }
    }

    print(f"DEBUG: Spawning bot to {request.meeting_url}")
    print(f"DEBUG: Output WebSocket: {output_url}")

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
            response.raise_for_status() # エラーなら例外発生
            return response.json()
            
        except httpx.HTTPStatusError as e:
            print(f"Meeting Baas API Error: {e.response.text}")
            return {"error": f"Failed to join meeting: {e.response.text}"}
        except Exception as e:
            print(f"Error: {e}")
            return {"error": str(e)}

@app.websocket("/ws/meeting-baas/{session_id}")
async def ws_meeting_baas(websocket: WebSocket, session_id: str):
    """Meeting Baasからの入力 (Raw Audio)"""
    # Meeting BaasはBotのため、managerへの登録は必須ではないが、
    # 処理フロー統一のためconnect呼出（ただし画面はないので送信しても無視されるだけ）
    await websocket.accept() 
    # 注意: Meeting Baasは16khz Raw PCMを送ってくる
    await process_audio(websocket, session_id, is_raw_audio=True)

@app.websocket("/ws/client/{session_id}")
async def ws_client(websocket: WebSocket, session_id: str):
    """ブラウザクライアント (表示 兼 マイク入力)"""
    await manager.connect(websocket, session_id)
    try:
        # ブラウザはWebMなどを送るため is_raw_audio=False (自動検出)
        await process_audio(websocket, session_id, is_raw_audio=False)
    except WebSocketDisconnect:
        manager.disconnect(websocket, session_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)