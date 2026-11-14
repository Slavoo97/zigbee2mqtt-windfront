import { describe, expect, it } from "vitest";
import type { Zigbee2MQTTNetworkMap } from "zigbee2mqtt";
import { BRIDGE_DEVICES } from "../mocks/bridgeDevices.js";
import { NETWORK_MAP_RESPONSE } from "../mocks/networkMapResponse.js";
import { getUnlinkedNodes } from "../src/components/network-page/index.js";
import { type BuildGraphOptions, buildGraph } from "../src/components/network-page/raw-map/buildGraph.js";
import { generateNetworkMap } from "./fixtures/generateNetworkMap.js";
import { legacyBuildGraph } from "./fixtures/legacyBuildGraph.js";

const MOCK_MAP = NETWORK_MAP_RESPONSE.payload.data.value as Zigbee2MQTTNetworkMap;

/** every combination of the boolean toggles */
const OPTION_COMBINATIONS: Omit<BuildGraphOptions, "excludedNodes" | "childrenLabel">[] = [];

for (let bits = 0; bits < 16; bits++) {
    OPTION_COMBINATIONS.push({
        showParents: Boolean(bits & 1),
        showChildren: Boolean(bits & 2),
        showSiblings: Boolean(bits & 4),
        showIcons: Boolean(bits & 8),
    });
}

describe("buildGraph", () => {
    it("builds the expected graph for the mock network map", () => {
        const [nodes, edges] = buildGraph(MOCK_MAP, BRIDGE_DEVICES.payload, {
            showParents: true,
            showChildren: true,
            showSiblings: true,
            showIcons: false,
            childrenLabel: "Children",
        });

        expect(nodes).toHaveLength(MOCK_MAP.nodes.length);
        expect(nodes.find((node) => node.id === "0x00158d0004261dc7")?.data.parent).toStrictEqual("Coordinator - Children");
        expect(edges.length).toBeGreaterThan(0);

        for (const edge of edges) {
            expect(nodes.some((node) => node.id === edge.source)).toStrictEqual(true);
            expect(nodes.some((node) => node.id === edge.target)).toStrictEqual(true);
        }
    });

    it("leaves out excluded nodes", () => {
        const excludedNodes = getUnlinkedNodes(MOCK_MAP);
        const [nodes] = buildGraph(MOCK_MAP, BRIDGE_DEVICES.payload, {
            showParents: true,
            showChildren: true,
            showSiblings: true,
            showIcons: false,
            excludedNodes,
            childrenLabel: "Children",
        });

        expect(nodes).toHaveLength(MOCK_MAP.nodes.length - excludedNodes.length);
        expect(nodes.some((node) => excludedNodes.some((excluded) => excluded.ieeeAddr === node.id))).toStrictEqual(false);
    });

    // regression: the optimized version must produce exactly the same graph as the original one
    describe("matches the original implementation", () => {
        const cases: [string, Zigbee2MQTTNetworkMap, Parameters<typeof buildGraph>[1]][] = [
            ["mock network map", MOCK_MAP, BRIDGE_DEVICES.payload],
            ...[10, 100, 300].map((size): [string, Zigbee2MQTTNetworkMap, Parameters<typeof buildGraph>[1]] => {
                const { map, devices } = generateNetworkMap(size);

                return [`generated ${size} nodes`, map, devices];
            }),
        ];

        it.each(cases)("%s", (_name, map, devices) => {
            const unlinked = getUnlinkedNodes(map);

            for (const toggles of OPTION_COMBINATIONS) {
                for (const excludedNodes of [undefined, unlinked]) {
                    const options: BuildGraphOptions = { ...toggles, excludedNodes, childrenLabel: "Children" };

                    expect(buildGraph(map, devices, options)).toStrictEqual(legacyBuildGraph(map, devices, options));
                }
            }
        });
    });
});
