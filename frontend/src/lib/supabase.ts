import { createBrowserClient } from '@supabase/ssr';

// 環境変数が読み込めない時のためのフォールバック
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ブラウザ側でCookieを自動管理してくれるクライアントを作成
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);