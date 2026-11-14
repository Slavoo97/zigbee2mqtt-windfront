import type { GraphEdge, GraphNode } from "reagraph";
import type { Zigbee2MQTTNetworkMap } from "zigbee2mqtt";
import type { Device } from "../../../types.js";
import { getZ2MDeviceImage } from "../../device/index.js";
import { EDGE_RELATIONSHIP_FILL_COLORS, type NetworkMapLink, type NetworkMapNode, NODE_TYPE_FILL_COLORS, ZigbeeRelationship } from "../index.js";

export type BuildGraphOptions = {
    showParents: boolean;
    showChildren: boolean;
    showSiblings: boolean;
    showIcons: boolean;
    /** Nodes left out of the graph (displayed separately) */
    excludedNodes?: NetworkMapNode[];
    /** Translated suffix used for the cluster of children of a parent */
    childrenLabel: string;
};

/**
 * Compute the reagraph nodes & edges from a raw network map.
 */
export function buildGraph(map: Zigbee2MQTTNetworkMap, devices: Device[], options: BuildGraphOptions): [GraphNode[], GraphEdge[]] {
    const { showParents, showChildren, showSiblings, showIcons, excludedNodes, childrenLabel } = options;
    const computedNodes: GraphNode[] = [];
    const computedEdges: GraphEdge[] = [];
    const processedLinks: [NetworkMapLink, NetworkMapLink | undefined][] = [];

    for (const node of map.nodes) {
        if (excludedNodes?.includes(node)) {
            // displayed separately
            continue;
        }

        const device = devices.find((device) => device.ieee_address === node.ieeeAddr);
        // determine the parent friendly name for clustering from either the target (parent is source) or the source (parent is target)
        const parent = map.links.find((link) => link.relationship === ZigbeeRelationship.NeighborIsParent && link.target.ieeeAddr === node.ieeeAddr);
        let parentFriendlyName = parent ? map.nodes.find((n) => n.ieeeAddr === parent!.source.ieeeAddr)?.friendlyName : undefined;

        if (!parent) {
            const child = map.links.find(
                (link) => link.relationship === ZigbeeRelationship.NeighborIsAChild && link.source.ieeeAddr === node.ieeeAddr,
            );
            parentFriendlyName = child ? map.nodes.find((n) => n.ieeeAddr === child!.target.ieeeAddr)?.friendlyName : undefined;

            if (parentFriendlyName) {
                parentFriendlyName += ` - ${childrenLabel}`;
            }
        }

        computedNodes.push({
            id: node.ieeeAddr,
            data: {
                ...node,
                parent: parentFriendlyName,
            },
            label: node.friendlyName,
            labelVisible: true,
            fill: NODE_TYPE_FILL_COLORS[node.type as keyof typeof NODE_TYPE_FILL_COLORS],
            icon:
                showIcons && device?.definition ? device.definition.icon || (device.supported ? getZ2MDeviceImage(device)[0] : undefined) : undefined,
        });
    }

    const bestSiblings = new Map<string, NetworkMapLink>();

    for (const link of map.links) {
        if (
            (!showParents && link.relationship === ZigbeeRelationship.NeighborIsParent) ||
            (!showChildren && link.relationship === ZigbeeRelationship.NeighborIsAChild) ||
            (!showSiblings && link.relationship === ZigbeeRelationship.NeighborIsASibling)
        ) {
            continue;
        }

        if (link.relationship === ZigbeeRelationship.NeighborIsASibling) {
            const bestSibling = bestSiblings.get(link.source.ieeeAddr);

            // pick lowest depth, or highest LQI, de-dupe LQI by lowest depth
            // not "perfect", but should represent the network mostly accurately, without crowding with pointless sibling links
            if (
                !bestSibling ||
                // XXX: add exception when depth===255 (non-value)?
                link.depth < bestSibling.depth ||
                link.lqi > bestSibling.lqi ||
                (bestSibling.lqi === link.lqi && link.depth < bestSibling.depth)
            ) {
                bestSiblings.set(link.source.ieeeAddr, link);
            }

            continue;
        }

        const oppositeLink = map.links.find(
            (oLink) => oLink.source.ieeeAddr === link.target.ieeeAddr && oLink.target.ieeeAddr === link.source.ieeeAddr,
        );

        // only add Parent when Parent+Child present
        if (!(link.relationship === ZigbeeRelationship.NeighborIsAChild && oppositeLink?.relationship === ZigbeeRelationship.NeighborIsParent)) {
            processedLinks.push([link, oppositeLink]);
        }
    }

    for (const [, bestSibling] of bestSiblings) {
        const oppositeLink = map.links.find(
            (oLink) => oLink.source.ieeeAddr === bestSibling.target.ieeeAddr && oLink.target.ieeeAddr === bestSibling.source.ieeeAddr,
        );

        processedLinks.push([bestSibling, oppositeLink]);
    }

    const ignoreLinks: NetworkMapLink[] = [];

    for (const [link, oppositeLink] of processedLinks) {
        if (ignoreLinks.includes(link)) {
            continue;
        }

        if (link.relationship === ZigbeeRelationship.NeighborIsASibling) {
            if (
                oppositeLink?.relationship === ZigbeeRelationship.NeighborIsParent ||
                oppositeLink?.relationship === ZigbeeRelationship.NeighborIsAChild
            ) {
                // skip Sibling link when Parent/Child link also present
                continue;
            }
        }

        computedEdges.push({
            id: `${link.source.ieeeAddr}-${link.target.ieeeAddr}-${link.relationship}`,
            data: link,
            label: oppositeLink ? `${link.lqi} / ${oppositeLink.lqi ?? "?"}` : `${link.lqi}`,
            size: link.relationship === ZigbeeRelationship.NoneOfTheAbove ? 0.5 : 1,
            labelVisible: true,
            source: link.source.ieeeAddr,
            target: link.target.ieeeAddr,
            fill: EDGE_RELATIONSHIP_FILL_COLORS[link.relationship as keyof typeof EDGE_RELATIONSHIP_FILL_COLORS],
        });
    }

    return [computedNodes, computedEdges];
}
