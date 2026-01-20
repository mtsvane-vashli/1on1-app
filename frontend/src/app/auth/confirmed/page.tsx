"use client";

import React, { useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function AuthConfirmedPage() {
    const router = useRouter();

    useEffect(() => {
        // 5秒後に自動リダイレクト (オプション)
        const timers = setTimeout(() => {
            router.push('/');
        }, 5000);
        return () => clearTimeout(timers);
    }, [router]);

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background decorations */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 max-w-md w-full bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-2xl p-8 shadow-2xl flex flex-col items-center text-center animate-in fade-in zoom-in duration-500">

                <div className="mb-6 relative">
                    <div className="absolute inset-0 bg-green-500/20 blur-xl rounded-full animate-pulse" />
                    <CheckCircle2 size={80} className="text-green-400 relative z-10" />
                </div>

                <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 mb-2">
                    認証完了
                </h1>

                <p className="text-gray-400 mb-8">
                    メールアドレスの確認が完了しました。<br />
                    ダッシュボードへ移動して、サービスの利用を開始しましょう。
                </p>

                <Link
                    href="/"
                    className="group w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_25px_rgba(37,99,235,0.5)] flex items-center justify-center gap-2"
                >
                    ダッシュボードへ進む
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Link>

                <div className="mt-6 text-xs text-gray-600">
                    5秒後に自動的に移動します...
                </div>
            </div>
        </div>
    );
}
