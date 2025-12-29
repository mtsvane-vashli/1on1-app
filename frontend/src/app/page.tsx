"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Transcript = {
  text: string;
  speaker: number;
};

export default function Home() {
  const router = useRouter();

  // --- State定義 ---
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

  // --- プロフィールチェック ---
  useEffect(() => {
    const checkUserStatus = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; 

      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();
      
      if (!profile || !profile.organization_id) {
        router.push('/onboarding');
      }
    };
    checkUserStatus();
  }, [router]);

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

  // ★修正1: async を追加
  const connectWebSocket = (isMicMode: boolean): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      cleanup();

      // トークン取得
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        alert("認証エラー: ログインし直してください");
        reject("No token");
        return;
      }

      const ws = new WebSocket(`ws://localhost:8000/ws/client/${sessionId}?token=${token}`);
      socketRef.current = ws;

      ws.onopen = () => {
        console.log("✅ WebSocket Connected!");
        setIsConnected(true);
        setMode(isMicMode ? "mic" : "viewer");
        resolve(); // ★ここで初めて「完了」とみなす
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

      ws.onerror = (err) => {
        console.error("WebSocket Error:", err);
        reject(err);
      };
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  // Botを呼び出す関数
  const handleJoinMeeting = async () => {
    if (!meetingUrl) return alert("会議URLを入力してください");

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      alert("認証エラー");
      return;
    }
    
    setIsJoining(true);
    
    // 1. WebSocket接続 (await済)
    await connectWebSocket(false);

    // 2. Bot派遣リクエスト
    try {
      const res = await fetch("http://localhost:8000/join-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ meeting_url: meetingUrl }),
      });
      
      const data = await res.json();
      if (data.error) {
        alert("エラー: " + data.error);
        cleanup(); 
      } else {
        console.log("Bot dispatched!", data);
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
    // ★修正2: ここにも await を追加 (ソケット準備完了を待つため)
    await connectWebSocket(true);
    
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
          <button 
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-white underline"
          >
            ログアウト
          </button>
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