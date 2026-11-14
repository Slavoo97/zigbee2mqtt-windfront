import merge from "lodash/merge.js";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GraphCanvas, type GraphCanvasRef, type LabelVisibilityType, type LayoutTypes, lightTheme, type Theme, useSelection } from "reagraph";
import store2 from "store2";
import type { Zigbee2MQTTNetworkMap } from "zigbee2mqtt";
import { useShallow } from "zustand/react/shallow";
import { NETWORK_MAP_CONFIG_KEY } from "../../localStoreConsts.js";
import { useAppStore } from "../../store.js";
import fontUrl from "./../../styles/NotoSans-Regular.ttf";
import { cssColorToRgba, getUnlinkedNodes } from "./index.js";
import { buildGraph } from "./raw-map/buildGraph.js";
import ContextMenu from "./raw-map/ContextMenu.js";
import Controls from "./raw-map/Controls.js";
import Legend from "./raw-map/Legend.js";
import UnlinkedNodes from "./raw-map/UnlinkedNodes.js";

export type NetworkMapConfig = {
    layoutType: LayoutTypes;
    labelType: LabelVisibilityType;
    nodeStrength: number;
    linkDistance: number;
    showIcons: boolean;
    /** Move the nodes without any link out of the graph, into a separate list */
    segregateUnlinked: boolean;
};

const DEFAULT_CONFIG: NetworkMapConfig = {
    layoutType: "forceDirected2d",
    labelType: "all",
    nodeStrength: -750,
    linkDistance: 50,
    showIcons: false,
    segregateUnlinked: true,
};

type RawNetworkMapProps = {
    sourceIdx: number;
    map: Zigbee2MQTTNetworkMap;
};

const RawNetworkMap = memo(({ sourceIdx, map }: RawNetworkMapProps) => {
    const { t } = useTranslation("network");
    const devices = useAppStore(useShallow((state) => state.devices[sourceIdx]));
    // merge with defaults to account for configs stored before a given option existed
    const [config, setConfig] = useState<NetworkMapConfig>(() => ({ ...DEFAULT_CONFIG, ...store2.get(NETWORK_MAP_CONFIG_KEY, {}) }));
    const [showParents, setShowParents] = useState(true);
    const [showChildren, setShowChildren] = useState(true);
    const [showSiblings, setShowSiblings] = useState(true);
    const graphRef = useRef<GraphCanvasRef | null>(null);

    useEffect(() => {
        store2.set(NETWORK_MAP_CONFIG_KEY, config);
    }, [config]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: specific trigger
    useEffect(() => {
        if (graphRef.current) {
            graphRef.current.resetControls();
            graphRef.current.centerGraph();
            graphRef.current.fitNodesInView();
        }
    }, [config.layoutType]);

    const theme: Theme = useMemo(() => {
        // re-used for perf
        const ctx = new OffscreenCanvas(1, 1).getContext("2d")!;
        const style = getComputedStyle(document.documentElement);
        const colorBase100 = cssColorToRgba(ctx, style.getPropertyValue("--color-base-100"));
        const colorBase200 = cssColorToRgba(ctx, style.getPropertyValue("--color-base-200"));
        const colorBaseContent = cssColorToRgba(ctx, style.getPropertyValue("--color-base-content"));
        const colorPrimary = cssColorToRgba(ctx, style.getPropertyValue("--color-primary"));
        const colorAccent = cssColorToRgba(ctx, style.getPropertyValue("--color-accent"));

        return merge({}, lightTheme, {
            canvas: { background: colorBase100 },
            node: {
                activeFill: colorAccent,
                label: { color: colorBaseContent, stroke: colorBase200, activeColor: colorAccent },
                subLabel: { color: colorBaseContent, stroke: "transparent", activeColor: colorAccent },
            },
            lasso: { border: `1px solid ${colorPrimary}`, background: "rgba(75, 160, 255, 0.1)" },
            ring: { fill: colorBaseContent, activeFill: colorAccent },
            edge: {
                fill: colorBaseContent,
                activeFill: colorAccent,
                label: {
                    stroke: colorBase200,
                    color: colorBaseContent,
                    activeColor: colorAccent,
                },
                subLabel: {
                    color: colorBaseContent,
                    stroke: "transparent",
                    activeColor: colorAccent,
                },
            },
            arrow: { fill: colorBaseContent, activeFill: colorAccent },
            cluster: {
                stroke: colorBaseContent,
                label: { stroke: colorBase200, color: colorBaseContent },
            },
        });
    }, []);

    const unlinkedNodes = useMemo(() => getUnlinkedNodes(map), [map]);

    const [nodes, edges] = useMemo(
        () =>
            buildGraph(map, devices, {
                showParents,
                showChildren,
                showSiblings,
                showIcons: config.showIcons,
                excludedNodes: config.segregateUnlinked ? unlinkedNodes : undefined,
                childrenLabel: t(($) => $.children),
            }),
        [map, unlinkedNodes, showParents, showChildren, showSiblings, t, devices, config.showIcons, config.segregateUnlinked],
    );

    // reagraph resets dragged positions whenever this reference changes, keep it stable across renders
    const layoutOverrides = useMemo(
        () => ({ nodeStrength: config.nodeStrength, linkDistance: config.linkDistance }),
        [config.nodeStrength, config.linkDistance],
    );

    const { selections, actives, onNodeClick, onCanvasClick } = useSelection({
        ref: graphRef,
        nodes: nodes,
        edges: edges,
        type: "single",
        pathSelectionType: "out",
        /** XXX: camera reset on unselect is annoying */
        focusOnSelect: false,
    });

    return (
        <>
            <Legend />
            <div className="relative h-screen z-6">
                <Controls
                    graphRef={graphRef}
                    config={config}
                    setConfig={setConfig}
                    nodes={nodes}
                    showParents={showParents}
                    setShowParents={setShowParents}
                    showChildren={showChildren}
                    setShowChildren={setShowChildren}
                    showSiblings={showSiblings}
                    setShowSiblings={setShowSiblings}
                />
                {config.segregateUnlinked && unlinkedNodes.length > 0 && <UnlinkedNodes sourceIdx={sourceIdx} nodes={unlinkedNodes} />}
                <GraphCanvas
                    ref={graphRef}
                    theme={theme}
                    nodes={nodes}
                    edges={edges}
                    clusterAttribute={config.layoutType.startsWith("forceDirected") ? "parent" : undefined}
                    selections={selections}
                    actives={actives}
                    onCanvasClick={onCanvasClick}
                    onNodeClick={onNodeClick}
                    layoutType={config.layoutType}
                    layoutOverrides={layoutOverrides}
                    sizingType="centrality"
                    labelType={config.labelType}
                    labelFontUrl={fontUrl}
                    edgeLabelPosition="natural"
                    lassoType="node"
                    cameraMode={config.layoutType.endsWith("3d") ? "rotate" : "pan"}
                    draggable
                    animated={false}
                    contextMenu={({ data: { data }, onCollapse, isCollapsed, canCollapse, onClose }) =>
                        data.friendlyName ? (
                            <ContextMenu data={data} onCollapse={onCollapse} isCollapsed={isCollapsed} canCollapse={canCollapse} onClose={onClose} />
                        ) : null
                    }
                />
            </div>
        </>
    );
});

export default RawNetworkMap;
