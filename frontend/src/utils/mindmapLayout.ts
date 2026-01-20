import { Edge, Node, Position } from '@xyflow/react';
import { hierarchy, tree } from 'd3-hierarchy';

// ノードのサイズ（幅・高さ）+ マージン
// レイアウト計算時に "ボックス" として扱うサイズ
const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;

export type LayoutDirection = 'LR' | 'TB';

/**
 * d3-hierarchy を使ってノード配置を計算する
 * @param nodes 
 * @param edges 
 * @param direction 'LR' (Left-to-Right) or 'TB' (Top-to-Bottom)
 */
export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction: LayoutDirection = 'LR') => {
    if (nodes.length === 0) return { nodes, edges };

    // 1. ノードとエッジから階層構造データを作成
    // d3.stratify() だと id/parentId が必要だが、edges から構築する方が汎用性が高い
    // ここでは "Root" を探して、再帰的に children を構築する簡易実装を行う (森構造も考慮)

    // 親マップを作成 (childId -> parentId)
    const parentMap = new Map<string, string>();
    edges.forEach(e => {
        parentMap.set(e.target, e.source);
    });

    // Rootノードを探す（親がいないノード）
    const rootNodes = nodes.filter(n => !parentMap.has(n.id));

    // d3 hierarchy 用のデータ構造を作成
    const buildTreeData = (node: Node): any => {
        const childrenEdges = edges.filter(e => e.source === node.id);
        const childrenNodes = childrenEdges.map(e => nodes.find(n => n.id === e.target)).filter((n): n is Node => !!n);

        return {
            ...node, // 元のデータを含める
            children: childrenNodes.map(buildTreeData)
        };
    };

    // 全てのRootに対してレイアウト計算を行い、結果をマージする（複数の独立した木がある場合）
    let allLayoutedNodes: Node[] = [];

    // 垂直方向のオフセット（複数の木が重ならないように）
    let currentYOffset = 0;

    rootNodes.forEach(root => {
        const data = buildTreeData(root);
        const rootHierarchy = hierarchy(data);

        // Tree Layout の設定
        const treeLayout = tree<any>();

        // ノードのサイズを指定 (width, height) - 回転前
        // 横方向レイアウトの場合、Xが階層(Depth)、Yが広がり
        treeLayout.nodeSize([NODE_HEIGHT + 20, NODE_WIDTH + 50]);

        const layout = treeLayout(rootHierarchy);

        // 座標を ReactFlow 用に変換
        // d3 tree (LR) : x=vertical(depth), y=horizontal(breadth) -> ReactFlow: x=horizontal, y=vertical
        layout.descendants().forEach((d) => {
            // 元のノードオブジェクト
            const originalNode = nodes.find(n => n.id === d.data.id);
            if (!originalNode) return;

            // 座標変換 (LRの場合)
            // d.x : 垂直方向の位置 (Top-Downの場合のX -> 横書きならY)
            // d.y : 水平方向の位置 (Top-Downの場合のY -> 横書きならX)

            let x, y;
            if (direction === 'LR') {
                x = d.y;
                y = d.x;
            } else {
                x = d.x;
                y = d.y;
            }

            // 複数の木がある場合のオフセット加算
            y += currentYOffset;

            allLayoutedNodes.push({
                ...originalNode,
                targetPosition: direction === 'LR' ? Position.Left : Position.Top,
                sourcePosition: direction === 'LR' ? Position.Right : Position.Bottom,
                position: { x, y },
            });
        });

        // 次の木のためにオフセット更新
        // この木の最大幅/高さなどを計算すべきだが、簡易的に固定値を足す
        // 本当は d.x の最大値 - 最小値 を見るべき
        let maxY = -Infinity;
        layout.descendants().forEach(d => { if (d.x > maxY) maxY = d.x; });
        currentYOffset += (maxY + 200);
    });

    // Rootですらない孤立ノード（エッジがない）もそのまま返す
    // (上記ロジックだとRootNodesに含まれるので処理されるはず)

    return { nodes: allLayoutedNodes, edges };
};
