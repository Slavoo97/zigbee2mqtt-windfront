import type { Zigbee2MQTTNetworkMap } from "zigbee2mqtt";
import { ZigbeeRelationship } from "../../src/components/network-page/index.js";
import type { Device } from "../../src/types.js";

type NetworkMapNode = Zigbee2MQTTNetworkMap["nodes"][number];
type NetworkMapLink = Zigbee2MQTTNetworkMap["links"][number];

/** Small seeded PRNG (mulberry32) to get the same network on every run */
const createRandom = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Generate a synthetic raw network map shaped like the Zigbee2MQTT one:
 * every link is an entry of the neighbor (LQI) table of its `target`, with `relationship` describing `source` from the point of view of `target`.
 *
 * - 1 coordinator, ~35% routers forming a tree (each router has a parent), the rest end devices attached to a random router/coordinator
 * - every router/coordinator also lists up to `siblingsPerRouter` random other routers as siblings
 *
 * @param size total number of nodes (coordinator included)
 */
export function generateNetworkMap(size: number, siblingsPerRouter = 8, seed = 224): { map: Zigbee2MQTTNetworkMap; devices: Device[] } {
    const random = createRandom(seed);
    const randomInt = (max: number) => Math.floor(random() * max);
    const routerCount = Math.round((size - 1) * 0.35);
    const nodes: NetworkMapNode[] = [];
    const links: NetworkMapLink[] = [];
    const depths: number[] = [];

    for (let i = 0; i < size; i++) {
        const type = i === 0 ? "Coordinator" : i <= routerCount ? "Router" : "EndDevice";

        nodes.push({
            ieeeAddr: `0x00158d00${i.toString(16).padStart(8, "0")}`,
            friendlyName: i === 0 ? "Coordinator" : `${type.toLowerCase()}_${i}`,
            type,
            networkAddress: i === 0 ? 0 : 0x1000 + i,
            failed: [],
            lastSeen: 1_700_000_000_000 + i,
            definition: i === 0 ? undefined : { model: `MODEL-${i % 7}`, vendor: `Vendor ${i % 3}`, supports: "linkquality", description: type },
        });
    }

    const addLink = (source: number, target: number, relationship: ZigbeeRelationship, depth: number) => {
        const lqi = randomInt(256);

        links.push({
            source: { ieeeAddr: nodes[source].ieeeAddr, networkAddress: nodes[source].networkAddress },
            target: { ieeeAddr: nodes[target].ieeeAddr, networkAddress: nodes[target].networkAddress },
            deviceType: nodes[source].type === "EndDevice" ? 0x02 : nodes[source].type === "Router" ? 0x01 : 0x00,
            rxOnWhenIdle: nodes[source].type === "EndDevice" ? 0x00 : 0x01,
            relationship,
            permitJoining: 0x02,
            depth,
            lqi,
            routes: [],
            linkquality: lqi,
            sourceIeeeAddr: nodes[source].ieeeAddr,
            targetIeeeAddr: nodes[target].ieeeAddr,
            sourceNwkAddr: nodes[source].networkAddress,
        });
    };

    depths[0] = 0;

    // routers: tree, parent is the coordinator or an earlier router
    for (let i = 1; i <= routerCount; i++) {
        const parent = randomInt(i);
        depths[i] = depths[parent] + 1;

        addLink(i, parent, ZigbeeRelationship.NeighborIsAChild, depths[i]);
        addLink(parent, i, ZigbeeRelationship.NeighborIsParent, depths[parent]);
    }

    // siblings in the neighbor table of each router/coordinator
    for (let target = 0; target <= routerCount && routerCount > 1; target++) {
        const count = Math.min(siblingsPerRouter, routerCount - 1);

        for (let s = 0; s < count; s++) {
            const source = 1 + randomInt(routerCount);

            if (source !== target) {
                addLink(source, target, ZigbeeRelationship.NeighborIsASibling, depths[source]);
            }
        }
    }

    // end devices: child in the neighbor table of their parent
    for (let i = routerCount + 1; i < size; i++) {
        const parent = randomInt(routerCount + 1);
        depths[i] = depths[parent] + 1;

        addLink(i, parent, ZigbeeRelationship.NeighborIsAChild, depths[i]);
    }

    // only the fields used by the network map are relevant here
    const devices = nodes.map(
        (node) =>
            ({
                ieee_address: node.ieeeAddr,
                friendly_name: node.friendlyName,
                type: node.type,
                supported: node.type !== "Coordinator",
                definition: node.definition ? { ...node.definition, source: "native" } : null,
            }) as unknown as Device,
    );

    return { map: { nodes, links }, devices };
}
