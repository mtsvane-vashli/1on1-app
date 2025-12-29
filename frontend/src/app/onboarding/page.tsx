"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

// ★簡易的な招待コード（本番ではDB管理や環境変数にするのがベターですが、今はこれで十分）
const SECRET_INVITE_CODE = "1on1-beta-2025";

export default function OnboardingPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState(""); // 招待コード入力欄
  const [loading, setLoading] = useState(false);

  // すでに登録済みの人が間違って来たらトップへ戻す
  useEffect(() => {
    const checkProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      // すでに会社IDを持っている＝登録済み
      if (profile && profile.organization_id) {
        router.push('/');
      }
    };
    checkProfile();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // ★ここで招待コードをチェック！
    if (inviteCode !== SECRET_INVITE_CODE) {
      alert("招待コードが正しくありません。管理者にお問い合わせください。");
      setLoading(false);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("ユーザーが見つかりません");

      // 1. 会社を作成
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: companyName })
        .select()
        .single();

      if (orgError) throw orgError;

      // 2. プロフィールを作成（または更新）して会社と紐付け
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          organization_id: org.id,
          display_name: displayName,
          role: 'manager', // 最初のアカウントなので管理者権限
          avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}` // 適当なアイコン
        });

      if (profileError) throw profileError;

      alert("登録が完了しました！");
      router.push("/"); // トップページへ

    } catch (error: any) {
      console.error(error);
      alert("登録に失敗しました: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-2xl">
        <h1 className="text-xl font-bold mb-2">ようこそ！</h1>
        <p className="text-gray-400 text-sm mb-6">初期設定を行いましょう</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">あなたのお名前</label>
            <input
              type="text"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2"
              placeholder="例: 山田 太郎"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">会社名 / 組織名</label>
            <input
              type="text"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2"
              placeholder="例: 株式会社ホゲホゲ"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <div className="pt-4 border-t border-gray-800">
            <label className="block text-sm font-medium text-yellow-500 mb-1">招待コード (必須)</label>
            <input
              type="text"
              required
              className="w-full bg-gray-800 border border-yellow-500/50 rounded-lg px-4 py-2"
              placeholder="管理者が発行したコードを入力"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg mt-4 transition-all"
          >
            {loading ? "設定中..." : "利用を開始する"}
          </button>
        </form>
      </div>
    </div>
  );
}