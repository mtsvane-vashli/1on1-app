'use client';

import React, { useEffect, Suspense } from 'react';
import Link from 'next/link';
import { CheckCircle2, ArrowRight, AlertTriangle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

function AuthConfirmedContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const error = searchParams.get('error');
    const errorCode = searchParams.get('code');

    useEffect(() => {
        // Only auto-redirect if NO error
        if (!error) {
            const timers = setTimeout(() => {
                router.push('/');
            }, 5000);
            return () => clearTimeout(timers);
        }
    }, [router, error]);

    if (error) {
        return (
            <div className="relative z-10 max-w-md w-full bg-gray-900/50 backdrop-blur-xl border border-red-500/30 rounded-2xl p-8 shadow-2xl flex flex-col items-center text-center animate-in fade-in zoom-in duration-500">
                <div className="mb-6 relative">
                    <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full animate-pulse" />
                    <AlertTriangle size={80} className="text-red-400 relative z-10" />
                </div>

                <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-red-400 mb-2">
                    認証エラー
                </h1>

                <p className="text-gray-400 mb-8 max-w-xs break-words">
                    確認プロセスで問題が発生しました。<br />
                    <span className="text-xs text-red-400 mt-2 block font-mono bg-black/30 p-2 rounded">
                        {error} {errorCode ? `(${errorCode})` : ''}
                    </span>
                </p>

                <div className="flex flex-col gap-3 w-full">
                    <Link
                        href="/login"
                        className="group w-full bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                        ログイン画面へ戻る
                    </Link>
                </div>
            </div>
        );
    }

    return (
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
    );
}

export default function AuthConfirmedPage() {
    return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background decorations */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
            </div>
            <Suspense fallback={<div className="text-white">Loading...</div>}>
                <AuthConfirmedContent />
            </Suspense>
        </div>
    );
}
