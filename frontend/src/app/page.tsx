"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Transcript = {
  text: string;
  speaker: number;
};

export default function Home() {
  const [sessionId] = useState("demo-session-1");
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState<"mic" | "viewer" | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [advice, setAdvice] = useState<string>("会話が始まるとここにアドバイスが表示されます...");
  
  // 会議URL入力用
  const [meetingUrl, setMeetingUrl] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setMode(null);
    setIsJoining(false);
  }, []);

  const connectWebSocket = (isMicMode: boolean) => {
    cleanup();
    const ws = new WebSocket(`ws://localhost:8000/ws/client/${sessionId}`);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("Connected to server");
      setIsConnected(true);
      setMode(isMicMode ? "mic" : "viewer");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "transcript") {
        setTranscripts((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.text === data.text && last.speaker === data.speaker) {
                return prev;
            }
            return [...prev, { text: data.text, speaker: data.speaker }];
        });
      } else if (data.type === "advice") {
        setAdvice(data.content);
      }
    };

    ws.onclose = () => {
      console.log("Disconnected");
      setIsConnected(false);
      setMode(null);
    };
  };

  // Botを呼び出す関数
  const handleJoinMeeting = async () => {
    if (!meetingUrl) return alert("会議URLを入力してください");
    
    setIsJoining(true);
    
    // 1. まずWebSocketをつなぐ (字幕待機状態にする)
    connectWebSocket(false);

    // 2. BackendにBot派遣リクエストを送る
    try {
      const res = await fetch("http://localhost:8000/join-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_url: meetingUrl }),
      });
      
      const data = await res.json();
      if (data.error) {
        alert("エラー: " + data.error);
        cleanup(); // 失敗したら切断
      } else {
        console.log("Bot dispatched!", data);
        // 成功しても isJoining はそのまま (「接続中」等の表示のため)
        // Botが入室して音声が来れば字幕が動き出す
      }
    } catch (err) {
      console.error(err);
      alert("Botの呼び出しに失敗しました");
      cleanup();
    } finally {
      setIsJoining(false);
    }
  };

  const startMicSession = async () => {
    connectWebSocket(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(event.data);
        }
      };
      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
    } catch (err) {
      console.error(err);
      cleanup();
      alert("マイク許可が必要です");
    }
  };

  const stopSession = () => {
    cleanup();
    setIsConnected(false);
  };

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8 font-sans">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center max-w-6xl mx-auto gap-4">
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
          AI 1on1 Assistant
        </h1>
        
        <div className="flex gap-4 items-center">
          {!isConnected ? (
            <>
              {/* 会議URL入力エリア */}
              <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
                <input 
                  type="text" 
                  placeholder="Zoom/Meet URL..." 
                  className="bg-transparent text-sm px-3 py-1 outline-none w-64 text-gray-200"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                />
                <button
                  onClick={handleJoinMeeting}
                  disabled={isJoining}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm font-bold transition-all disabled:opacity-50"
                >
                  {isJoining ? "Bot起動中..." : "Bot派遣"}
                </button>
              </div>

              <div className="w-[1px] h-8 bg-gray-700 mx-2"></div>

              <button
                onClick={startMicSession}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-all text-sm"
              >
                対面 (マイク)
              </button>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-sm font-mono text-green-400 bg-green-900/30 px-3 py-1 rounded animate-pulse">
                ● {mode === "mic" ? "Mic Active" : "Bot Active"}
              </span>
              <button
                onClick={stopSession}
                className="px-6 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-bold transition-all text-sm"
              >
                終了
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 以下、字幕エリアとアドバイスエリアは前回と同じなので省略してもOKですが、念のため構造維持 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[80vh] max-w-6xl mx-auto">
        <div className="md:col-span-2 bg-gray-900/50 rounded-xl p-6 overflow-y-auto border border-gray-800 flex flex-col shadow-inner">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Timeline</h2>
            <span className="text-xs text-gray-600">Session: {sessionId}</span>
          </div>
          <div className="space-y-4 flex-1">
            {transcripts.length === 0 && (
              <div className="text-gray-600 text-center mt-20">
                {mode === "viewer" ? "Botが会議に参加するのを待っています..." : "会話を開始してください..."}
              </div>
            )}
            {transcripts.map((t, i) => (
              <div key={i} className={`flex ${t.speaker === 0 ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] p-4 rounded-2xl ${
                  t.speaker === 0 
                    ? "bg-blue-600/20 border border-blue-500/20 text-blue-100 rounded-tr-none" 
                    : "bg-gray-800 border border-gray-700 text-gray-300 rounded-tl-none"
                }`}>
                  <p className="text-[10px] opacity-40 mb-1 uppercase tracking-wide">Speaker {t.speaker}</p>
                  <p className="leading-relaxed">{t.text}</p>
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        <div className="bg-gray-900/50 rounded-xl p-6 border border-purple-500/20 backdrop-blur-sm shadow-lg shadow-purple-900/10">
          <h2 className="text-sm font-semibold mb-4 text-purple-400 flex items-center gap-2 uppercase tracking-wider">
             AI Coach
          </h2>
          <div className="bg-gradient-to-b from-purple-900/10 to-transparent p-5 rounded-xl border border-purple-500/20 min-h-[200px] text-lg leading-relaxed text-purple-100">
            {advice}
          </div>
        </div>
      </div>
    </div>
  );
}