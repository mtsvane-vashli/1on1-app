"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, BrainCircuit } from "lucide-react";
import MindMap from "./MindMap";

type MindMapDrawerProps = {
    dbSessionId: string | null;
};

export default function MindMapDrawer({ dbSessionId }: MindMapDrawerProps) {
    const [isOpen, setIsOpen] = useState(false);

    // セッションIDがない（未接続）時は表示しない
    if (!dbSessionId) return null;

    return (
        <>
            {/* Toggle Handle (Visible when closed) */}
            <div
                className={`fixed top-1/2 right-0 transform -translate-y-1/2 z-50 transition-all duration-300 ${isOpen ? "translate-x-full" : "translate-x-0"}`}
            >
                <button
                    onClick={() => setIsOpen(true)}
                    className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-l-xl shadow-[0_0_15px_rgba(37,99,235,0.5)] flex flex-col items-center gap-1 border-l border-t border-b border-blue-400"
                >
                    <BrainCircuit size={20} />
                    <span className="writing-vertical-rl text-xs font-bold tracking-widest py-2">MIND MAP</span>
                    <ChevronLeft size={16} />
                </button>
            </div>

            {/* Drawer Container */}
            <div
                className={`fixed inset-y-0 right-0 w-[90vw] md:w-[60vw] bg-gray-900 border-l border-gray-700 shadow-2xl transform transition-transform duration-300 z-50 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
            >
                {/* Header / Controls */}
                <div className="absolute top-4 left-0 -translate-x-full">
                    <button
                        onClick={() => setIsOpen(false)}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 p-3 rounded-l-xl shadow-lg border border-gray-700 border-r-0"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>

                <div className="h-full w-full flex flex-col">
                    <div className="bg-gray-900 border-b border-gray-800 p-4 flex justify-between items-center">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-blue-400">
                            <BrainCircuit />
                            Mind Map
                            <span className="text-xs text-gray-500 font-normal ml-2 font-mono">{dbSessionId}</span>
                        </h3>
                    </div>

                    <div className="flex-1 bg-gray-950 relative overflow-hidden">
                        {/* Only render MindMap when drawer is open (or always render to keep state? -> Always render to keep state, but handle perf if needed) */}
                        {/* Always rendering to keep ws connection alive and state managed */}
                        <MindMap dbSessionId={dbSessionId} />
                    </div>
                </div>
            </div>

            {/* Backdrop (Optional: clear overlay to close when clicking outside) */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
                    onClick={() => setIsOpen(false)}
                />
            )}
        </>
    );
}
