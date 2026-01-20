"use client";

import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
    ReactFlow,
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    Edge,
    Node,
    BackgroundVariant,
    Panel,
    useReactFlow,
    ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Save, Loader2, Layout, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import MindMapNode from './MindMapNode';
import { getLayoutedElements } from '@/utils/mindmapLayout';

// API Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const initialNodes: Node[] = [
    { id: 'root', position: { x: 0, y: 0 }, data: { label: 'Central Idea' }, type: 'mindMap' },
];

const initialEdges: Edge[] = [];

// Node Types definition
// outside component to avoid re-creation
const nodeTypes = {
    mindMap: MindMapNode,
};

type MindMapProps = {
    dbSessionId: string;
    readOnly?: boolean;
};

function MindMapContent({ dbSessionId, readOnly = false }: MindMapProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const { fitView, getNodes, getEdges } = useReactFlow();

    // --- Helpers ---
    const updateNodeLabel = useCallback((nodeId: string, newLabel: string) => {
        // ReadOnlyなら更新しない
        if (readOnly) return;

        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === nodeId) {
                    node.data = { ...node.data, label: newLabel };
                }
                return node;
            })
        );
    }, [setNodes, readOnly]);

    // Custom Node用コールバック + ReadOnlyフラグを注入
    useEffect(() => {
        setNodes((nds) =>
            nds.map(n => ({
                ...n,
                type: 'mindMap',
                data: { ...n.data, onLabelChange: updateNodeLabel, readOnly: readOnly },
                draggable: !readOnly // ReactFlowのNodeOption
            }))
        );
    }, [updateNodeLabel, setNodes, readOnly]);


    // --- API Functions ---
    const fetchMindMap = useCallback(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) return;

            const res = await fetch(`${API_BASE_URL}/sessions/${dbSessionId}/mindmap`, {
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                if (data.nodes && data.nodes.length > 0) {
                    // ロードしたノードにもコールバックとTypeを付与
                    const loadedNodes = data.nodes.map((n: Node) => ({
                        ...n,
                        type: 'mindMap',
                        data: { ...n.data, onLabelChange: updateNodeLabel, readOnly: readOnly },
                        draggable: !readOnly
                    }));
                    setNodes(loadedNodes);
                    setEdges(data.edges);

                    // 初回ロード時は少し待ってからFitView (レンダリング待ち)
                    setTimeout(() => {
                        window.requestAnimationFrame(() => fitView());
                    }, 100);
                }
            }
        } catch (e) {
            console.error("Failed to load mind map", e);
        } finally {
            setIsLoading(false);
        }
    }, [dbSessionId, setNodes, setEdges, updateNodeLabel, fitView, readOnly]);

    const saveMindMap = useCallback(async (currentNodes: Node[], currentEdges: Edge[]) => {
        if (readOnly) return; // 保存しない

        setIsSaving(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) return;

            await fetch(`${API_BASE_URL}/sessions/${dbSessionId}/mindmap`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ nodes: currentNodes, edges: currentEdges })
            });
        } catch (e) {
            console.error("Failed to save mind map", e);
        } finally {
            setIsSaving(false);
        }
    }, [dbSessionId, readOnly]);

    // --- Effects ---

    // Load on mount
    useEffect(() => {
        if (dbSessionId) {
            fetchMindMap();
        }
    }, [dbSessionId, fetchMindMap]);

    // Auto-save debouncer
    useEffect(() => {
        if (isLoading || readOnly) return;

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // データ変更検知: nodes/edgesの中身が変わったら保存
        saveTimeoutRef.current = setTimeout(() => {
            saveMindMap(nodes, edges);
        }, 2000);

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [nodes, edges, saveMindMap, isLoading, readOnly]);

    const onConnect = useCallback(
        (params: Connection) => {
            if (readOnly) return;
            setEdges((eds) => addEdge(params, eds));
        },
        [setEdges, readOnly],
    );

    // --- Actions ---

    const onLayout = useCallback(() => {
        try {
            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                getNodes(),
                getEdges()
            );

            setNodes([...layoutedNodes]);
            setEdges([...layoutedEdges]);

            window.requestAnimationFrame(() => fitView({ duration: 800 }));
        } catch (e) {
            console.error("Layout failed", e);
            alert("レイアウトに失敗しました。循環参照がある可能性があります。");
        }
    }, [getNodes, getEdges, setNodes, setEdges, fitView]);

    // 新しい子ノードを追加
    const addChildNode = useCallback((parentNodeId: string) => {
        if (readOnly) return;

        const parentNode = nodes.find(n => n.id === parentNodeId);
        if (!parentNode) return;

        // 既存の子ノード数をカウントしてY座標をずらす
        const existingChildren = edges.filter(e => e.source === parentNodeId);
        const childCount = existingChildren.length;
        const spacing = 60; // 縦の間隔

        const newNodeId = `node-${Date.now()}`;
        const newNode: Node = {
            id: newNodeId,
            type: 'mindMap',
            // 親の右側に配置。Yは子供の数だけ下にずらす (簡易計算。Layoutボタンで整形推奨)
            position: {
                x: parentNode.position.x + 250,
                y: parentNode.position.y + (childCount * spacing)
            },
            data: { label: 'New Topic', onLabelChange: updateNodeLabel, readOnly: readOnly },
        };

        const newEdge: Edge = {
            id: `edge-${parentNodeId}-${newNodeId}`,
            source: parentNodeId,
            target: newNodeId,
        };

        setNodes((nds) => nds.concat(newNode));
        setEdges((eds) => eds.concat(newEdge));
    }, [nodes, edges, setNodes, setEdges, updateNodeLabel, readOnly]);

    // 新しい兄弟ノードを追加 (親を探して、その子として追加)
    const addSiblingNode = useCallback((nodeId: string) => {
        if (readOnly) return;

        // 1. 親エッジを探す
        const parentEdge = edges.find(e => e.target === nodeId);
        if (!parentEdge) {
            // 親がいない = Rootなので、子を追加する動きにする
            addChildNode(nodeId);
            return;
        }

        // 親ID
        const parentId = parentEdge.source;
        addChildNode(parentId);

    }, [edges, addChildNode, readOnly]);

    const deleteNode = useCallback((nodeId: string) => {
        if (readOnly) return;

        // 再帰的に削除するために、対象ノードをRootとするサブツリーを特定する必要がある
        // ここでは簡易的に、ReactFlowの機能で削除する (サブツリー削除はReactFlow標準ではやらないので自前実装)

        const nodesToDelete = new Set<string>();
        const edgesToDelete = new Set<string>();

        const traverse = (currentId: string) => {
            nodesToDelete.add(currentId);
            // 子を探す
            const childEdges = edges.filter(e => e.source === currentId);
            childEdges.forEach(e => {
                edgesToDelete.add(e.id);
                if (!nodesToDelete.has(e.target)) {
                    traverse(e.target);
                }
            });
        };

        traverse(nodeId);

        // 親からのエッジも消す
        const parentEdge = edges.find(e => e.target === nodeId);
        if (parentEdge) edgesToDelete.add(parentEdge.id);

        setNodes((nds) => nds.filter(n => !nodesToDelete.has(n.id)));
        setEdges((eds) => eds.filter(e => !edgesToDelete.has(e.id)));

    }, [edges, setNodes, setEdges, readOnly]);

    // --- Keyboard Shortcuts ---
    // ReactFlowの onKeyDown だとCanvasにフォーカスが必要なので、window eventにするか、
    // ReactFlowの pane へのイベントを使う

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        // ReadOnlyなら無視
        if (readOnly) return;

        // 編集中(Inputへの入力)は発火させない
        // (MindMapNode側で stopPropagation しているはずだが念の為)
        if ((e.target as HTMLElement).tagName === 'INPUT') return;

        const selectedNodes = nodes.filter(n => n.selected);
        if (selectedNodes.length === 0) return;
        const selectedId = selectedNodes[0].id; // 複数選択時は先頭だけ対象

        if (e.key === 'Tab') {
            e.preventDefault();
            addChildNode(selectedId);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            addSiblingNode(selectedId);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            // ReactFlowのデフォルト削除と競合する可能性あり
            // デフォルト機能を無効化(deleteKeyCode={null})して自前実装
            e.preventDefault();
            deleteNode(selectedId);
        }

    }, [nodes, addChildNode, addSiblingNode, deleteNode, readOnly]);


    if (isLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2" />
                <p>Loading Map...</p>
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes} // Custom Node
                onKeyDown={onKeyDown}
                deleteKeyCode={null} // 自前実装のため無効化
                colorMode="dark"
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable={!readOnly} // 選択はさせても良いが、操作できないのでSelected状態が紛らわしいかもしれない。一旦選択可にする（Layout後に見やすくするため）
                fitView
            >
                <Controls />
                <MiniMap />
                <Background variant={BackgroundVariant.Dots} gap={12} size={1} />

                <Panel position="top-right" className="flex gap-2">
                    <button
                        onClick={onLayout}
                        className="bg-purple-600 hover:bg-purple-500 text-white p-2 rounded shadow flex items-center gap-1 text-xs font-bold transition-colors"
                        title="Auto Layout"
                    >
                        <Layout size={16} /> Auto Layout
                    </button>
                    <div className={`flex items-center gap-1 px-3 py-2 rounded text-xs font-mono border ${readOnly ? "bg-gray-800 border-gray-600 text-gray-400" : isSaving ? "bg-yellow-900/20 border-yellow-700 text-yellow-500" : "bg-green-900/20 border-green-700 text-green-500"}`}>
                        {readOnly ? (
                            <>
                                <Lock size={14} /> Read Only
                            </>
                        ) : (
                            <>
                                <Save size={14} className={isSaving ? "animate-pulse" : ""} />
                                {isSaving ? "Saving..." : "Saved"}
                            </>
                        )}
                    </div>
                </Panel>

                {!readOnly && (
                    <Panel position="bottom-center" className="bg-gray-800/80 p-2 rounded-lg text-[10px] text-gray-400 flex gap-4 backdrop-blur-sm border border-gray-700">
                        <span><kbd className="bg-gray-700 px-1 rounded">Tab</kbd> Add Child</span>
                        <span><kbd className="bg-gray-700 px-1 rounded">Enter</kbd> Add Sibling</span>
                        <span><kbd className="bg-gray-700 px-1 rounded">Del</kbd> Delete</span>
                        <span><kbd className="bg-gray-700 px-1 rounded">DblClick</kbd> Edit Text</span>
                    </Panel>
                )}
            </ReactFlow>
        </div>
    );
}

// ReactFlowProvider is needed for useReactFlow hook
export default function MindMapWrapper(props: MindMapProps) {
    return (
        <ReactFlowProvider>
            <MindMapContent {...props} />
        </ReactFlowProvider>
    );
}
