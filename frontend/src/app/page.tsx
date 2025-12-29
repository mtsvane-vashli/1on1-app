"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 環境変数からAPIのURLを取得 (なければlocalhost)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// http -> ws, https -> wss に変換
const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

// --- 型定義 ---
type Transcript = {
  text: string;
  speaker: number;
};

type SessionHistory = {
  id: string;
  created_at: string;
  title: string;
  summary: string | null;
  mode: string;
};

export default function Home() {
  const router = useRouter();

  // --- State定義 ---
  // ★修正: setSessionId を使えるようにする
  const [sessionId, setSessionId] = useState("demo-session-1");
  
  const [isConnected, setIsConnected] = useState(false);
  // ★修正: "bot" を型に追加
  const [mode, setMode] = useState<"mic" | "viewer" | "bot" | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [advice, setAdvice] = useState<string>("会話が始まるとここにアドバイスが表示されます...");
  
  // 要約・履歴用
  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [historyList, setHistoryList] = useState<SessionHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  // 会議URL入力用
  const [meetingUrl, setMeetingUrl] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // --- 1. プロフィールチェック ---
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

  // --- 2. 履歴データの取得 ---
  const fetchHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false });

      if (error) throw error;
      setHistoryList(data || []);
    } catch (error) {
      console.error("History fetch error:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // --- 3. クリーンアップ ---
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
    
    // 状態リセット
    setTranscripts([]);
    setAdvice("会話が始まるとここにアドバイスが表示されます...");
    setDbSessionId(null);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // --- 4. WebSocket接続 (IDを指定可能に修正) ---
  // ★修正: targetSessionId 引数を追加
  const connectWebSocket = (isMicMode: boolean, targetSessionId: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      if (socketRef.current) {
         socketRef.current.close();
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        alert("認証エラー: ログインし直してください");
        reject("No token");
        return;
      }

      // ★修正: 引数で渡されたIDを使って接続する
      const modeParam = isMicMode ? "mic" : "viewer";
      const ws = new WebSocket(`${WS_BASE_URL}/ws/client/${targetSessionId}?token=${token}&client_mode=${modeParam}`);
      socketRef.current = ws;

      ws.onopen = () => {
        console.log("✅ WebSocket Connected! Session:", targetSessionId);
        setIsConnected(true);
        setMode(isMicMode ? "mic" : "viewer");
        resolve();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === "db_session_id") {
            setDbSessionId(data.id);
        }
        else if (data.type === "transcript") {
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
      };

      ws.onerror = (err) => {
        console.error("WebSocket Error:", err);
        reject(err);
      };
    });
  };

  // --- 5. アクションハンドラ ---
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const handleJoinMeeting = async () => {
    if (!meetingUrl) return alert("会議URLを入力してください");

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      alert("認証エラー");
      return;
    }
    
    setIsJoining(true);
    cleanup(); 
    
    // ★修正: 新しいセッションIDを生成
    const newSessionId = `session-${Date.now()}`;
    setSessionId(newSessionId);

    try {
      // ★修正: 生成したIDを渡す
      await connectWebSocket(false, newSessionId);

      const res = await fetch(`${API_BASE_URL}/join-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ meeting_url: meetingUrl, session_id: newSessionId }),
      });
      
      const data = await res.json();
      if (data.error) {
        alert("エラー: " + data.error);
        cleanup(); 
      } else {
        console.log("Bot dispatched!", data);
        // ★Bot用セッションIDを保存 (要約用)
        if (data.db_session_id) {
            setDbSessionId(data.db_session_id);
        }
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
    cleanup(); 
    
    // ★修正: 新しいセッションIDを生成
    const newSessionId = `session-${Date.now()}`;
    setSessionId(newSessionId);

    try {
      console.log("Connecting to WebSocket...");
      // ★修正: 生成したIDを渡す
      await connectWebSocket(true, newSessionId);
      console.log("WebSocket Ready. Starting Mic...");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(event.data);
        }
      };

      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      console.log("Mic Started!");
      
    } catch (err) {
      console.error("Mic Error:", err);
      cleanup();
      alert("マイク許可が必要です");
    }
  };

  const handleStopAndSummarize = async () => {
    if (mode === "viewer" && !dbSessionId) {
        cleanup();
        setIsConnected(false);
        fetchHistory();
        return;
    }

    cleanup(); 
    setIsConnected(false); 

    if (!dbSessionId) {
        fetchHistory();
        return;
    }

    if (confirm("会議を終了します。要約を作成しますか？")) {
        setIsSummarizing(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const res = await fetch(`${API_BASE_URL}/summarize`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ db_session_id: dbSessionId }),
            });
            
            const data = await res.json();
            setSummary(data.summary);
            await fetchHistory(); 
            
        } catch (e) {
            console.error(e);
            alert("要約の作成に失敗しました");
        } finally {
            setIsSummarizing(false);
        }
    } else {
        fetchHistory();
    }
  };

  const loadSession = async (session: SessionHistory) => {
    cleanup();
    setIsConnected(true);
    setMode('viewer');
    setSummary(session.summary);
    setAdvice("過去のログを閲覧中...");
    // ★閲覧時はその履歴のIDを表示するとなお親切かも（任意）
    // setSessionId(session.id); 

    const { data: transcriptsData } = await supabase
      .from('transcripts')
      .select('content, speaker')
      .eq('session_id', session.id)
      .order('timestamp', { ascending: true });

    if (transcriptsData) {
      const formatted = transcriptsData.map(t => ({
        text: t.content,
        speaker: t.speaker
      }));
      setTranscripts(formatted);
    }
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // --- Render ---
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
                ● {mode === "mic" ? "Mic Active" : mode === "bot" ? "Bot Active" : "Viewer Mode"}
              </span>
              <button
                onClick={handleStopAndSummarize}
                className="px-6 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-bold transition-all text-sm"
              >
                {mode === "viewer" && !dbSessionId ? "閉じる" : "終了"}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* --- メインコンテンツエリア --- */}
      {!isConnected ? (
        // ■■■ ダッシュボード表示 (未接続時) ■■■
        <div className="max-w-4xl mx-auto mt-10">
          <h2 className="text-xl font-bold mb-6 text-gray-400 border-b border-gray-800 pb-2 flex items-center gap-2">
            📂 過去の1on1履歴
          </h2>

          {isLoadingHistory ? (
            <div className="text-center text-gray-600 animate-pulse py-10">読み込み中...</div>
          ) : historyList.length === 0 ? (
            <div className="text-center text-gray-500 py-16 bg-gray-900/30 rounded-xl border border-gray-800 border-dashed">
              <p className="text-lg mb-2">履歴がまだありません</p>
              <p className="text-sm opacity-70">新しい会議を始めて、AIのアドバイスを体験しましょう！</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {historyList.map((session) => (
                <div 
                  key={session.id}
                  onClick={() => loadSession(session)}
                  className="bg-gray-900 border border-gray-800 p-6 rounded-xl cursor-pointer hover:border-blue-500/50 hover:bg-gray-800 transition-all group relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-bold text-lg text-gray-200 group-hover:text-blue-400 transition-colors">
                      {session.title || "無題の会議"}
                    </h3>
                    <span className="text-xs text-gray-500 font-mono bg-gray-950 px-2 py-1 rounded border border-gray-800">
                      {new Date(session.created_at).toLocaleDateString()} {new Date(session.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  
                  {session.summary ? (
                    <p className="text-gray-400 text-sm line-clamp-2 leading-relaxed">
                      {session.summary.replace(/[*#]/g, '')}
                    </p>
                  ) : (
                    <p className="text-gray-600 text-sm italic">まだ要約がありません</p>
                  )}
                  
                  <div className="mt-4 flex gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${
                        session.mode === 'bot' 
                        ? 'border-purple-500/30 text-purple-400 bg-purple-900/10' 
                        : 'border-blue-500/30 text-blue-400 bg-blue-900/10'
                    }`}>
                        {session.mode === 'bot' ? 'Bot参加' : '対面マイク'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // ■■■ 会議・閲覧画面 (接続中) ■■■
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[80vh] max-w-6xl mx-auto">
          {/* 左側: 字幕 */}
          <div className="md:col-span-2 bg-gray-900/50 rounded-xl p-6 overflow-y-auto border border-gray-800 flex flex-col shadow-inner">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Timeline</h2>
              <span className="text-xs text-gray-600">Session: {sessionId}</span>
            </div>
            <div className="space-y-4 flex-1">
              {transcripts.length === 0 && (
                <div className="text-gray-600 text-center mt-20">
                  {mode === "viewer" 
                    ? "データ読み込み中..." 
                    : mode === "mic" 
                        ? "会話を開始してください..." 
                        : "Botが会議に参加するのを待っています..."}
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

          {/* 右側: AIアドバイス */}
          <div className="bg-gray-900/50 rounded-xl p-6 border border-purple-500/20 backdrop-blur-sm shadow-lg shadow-purple-900/10">
            <h2 className="text-sm font-semibold mb-4 text-purple-400 flex items-center gap-2 uppercase tracking-wider">
               AI Coach
            </h2>
            <div className="bg-gradient-to-b from-purple-900/10 to-transparent p-5 rounded-xl border border-purple-500/20 min-h-[200px] text-lg leading-relaxed text-purple-100">
              {advice}
            </div>
          </div>

          {/* 要約表示モーダル */}
          {(isSummarizing || summary) && (
              <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                  <div className="bg-gray-900 border border-gray-700 p-8 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                      <h2 className="text-2xl font-bold mb-4 text-white">
                          {isSummarizing ? "📝 要約を作成中..." : "🎉 会議のまとめ"}
                      </h2>
                      
                      {isSummarizing ? (
                          <div className="animate-pulse flex space-x-4">
                              <div className="flex-1 space-y-4 py-1">
                                  <div className="h-4 bg-gray-700 rounded w-3/4"></div>
                                  <div className="space-y-2">
                                      <div className="h-4 bg-gray-700 rounded"></div>
                                      <div className="h-4 bg-gray-700 rounded w-5/6"></div>
                                  </div>
                              </div>
                          </div>
                      ) : (
                          <div className="prose prose-invert">
                              <pre className="whitespace-pre-wrap font-sans text-gray-300">
                                  {summary}
                              </pre>
                              <button 
                                  onClick={() => setSummary(null)}
                                  className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold"
                              >
                                  閉じる
                              </button>
                          </div>
                      )}
                  </div>
              </div>
          )}
        </div>
      )}
    </div>
  );
}