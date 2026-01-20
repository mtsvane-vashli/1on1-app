"use client";

import { Handle, Position, NodeProps } from '@xyflow/react';
import { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function MindMapNode({ data, selected, id }: NodeProps) {
    // data.label は string を想定
    const [label, setLabel] = useState(data.label as string || "New Node");
    const [isEditing, setIsEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // 初回マウント時、"New Node" 等の特定条件なら編集モードにする？
    // -> UX的に邪魔かもしれないので、基本はダブルクリック編集とする

    // 外部からの更新反映
    useEffect(() => {
        setLabel(data.label as string);
    }, [data.label]);

    // 編集モードに入ったらフォーカス
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const startEditing = () => {
        if (data.readOnly) return;
        setIsEditing(true);
    };

    const stopEditing = () => {
        setIsEditing(false);
        // 親コンポーネント(Flow)に通知してデータを更新
        // ここで data.onLabelChange などのコールバックを呼ぶ設計が綺麗
        if (data.onLabelChange && typeof data.onLabelChange === 'function') {
            data.onLabelChange(id, label);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            stopEditing();
        }
    };

    return (
        <div
            className={`px-4 py-2 shadow-md rounded-lg bg-gray-800 border-2 transition-all min-w-[150px]
            ${selected ? 'border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'border-gray-600'}
        `}
        >
            {/* Target (Input) Handle - 左側 */}
            {/* Rootノード(データで判定)はTarget不要かもしれないが、汎用的に付けておく */}
            <Handle type="target" position={Position.Left} className="w-3 h-3 bg-blue-400 !-left-1.5" />

            <div className="flex items-center justify-center">
                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        onBlur={stopEditing}
                        onKeyDown={handleKeyDown}
                        className="bg-transparent text-white text-center outline-none w-full"
                        // ドラッグ不可にする (テキスト選択できるように)
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div
                        onDoubleClick={startEditing}
                        className="cursor-text text-center w-full select-none text-white font-medium"
                    >
                        {label}
                    </div>
                )}
            </div>

            {/* Source (Output) Handle - 右側 */}
            <Handle type="source" position={Position.Right} className="w-3 h-3 bg-blue-400 !-right-1.5" />
        </div>
    );
}
