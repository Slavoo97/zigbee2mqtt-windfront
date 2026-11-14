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

/** Key identifying a directed link between two nodes */
const linkKey = (sourceIeeeAddr: string, targetIeeeAddr: string): string => `${sourceIeeeAddr}|${targetIeeeAddr}`;

/** Set the value only if the key is not present yet (keeps the first match, same as `Array.find`) */
const setFirst = <K, V>(map: Map<K, V>, key: K, value: V): void => {
    if (!map.has(key)) {
        map.set(key, value);
    }
};

/**
 * Compute the reagraph nodes & edges from a raw network map.
 *
 * All lookups are done through maps built in a single pass, keeping the whole computation linear in the number of nodes/links/devices
 * (instead of searching the arrays for every node and every link).
 */
export function buildGraph(map: Zigbee2MQTTNetworkMap, devices: Device[], options: BuildGraphOptions): [GraphNode[], GraphEdge[]] {
    const { showParents, showChildren, showSiblings, showIcons, excludedNodes, childrenLabel } = options;
    const computedNodes: GraphNode[] = [];
    const computedEdges: GraphEdge[] = [];
    const processedLinks: [NetworkMapLink, NetworkMapLink | undefined][] = [];
    const excluded = excludedNodes ? new Set(excludedNodes) : undefined;
    const devicesByIeee = new Map<string, Device>();
    const nodesByIeee = new Map<string, NetworkMapNode>();
    /** first Parent link by target (the parent is the source) */
    const parentLinks = new Map<string, NetworkMapLink>();
    /** first Child link by source (the parent is the target) */
    const childLinks = new Map<string, NetworkMapLink>();
    /** first link by source+target, used to find the opposite link */
    const linksByKey = new Map<string, NetworkMapLink>();

    for (const device of devices) {
        setFirst(devicesByIeee, device.ieee_address, device);
    }

    for (const node of map.nodes) {
        setFirst(nodesByIeee, node.ieeeAddr, node);
    }

    for (const link of map.links) {
        if (link.relationship === ZigbeeRelationship.NeighborIsParent) {
            setFirst(parentLinks, link.target.ieeeAddr, link);
        } else if (link.relationship === ZigbeeRelationship.NeighborIsAChild) {
            setFirst(childLinks, link.source.ieeeAddr, link);
        }

        setFirst(linksByKey, linkKey(link.source.ieeeAddr, link.target.ieeeAddr), link);
    }

    for (const node of map.nodes) {
        if (excluded?.has(node)) {
            // displayed separately
            continue;
        }

        const device = devicesByIeee.get(node.ieeeAddr);
        // determine the parent friendly name for clustering from either the target (parent is source) or the source (parent is target)
        const parent = parentLinks.get(node.ieeeAddr);
        let parentFriendlyName = parent ? nodesByIeee.get(parent.source.ieeeAddr)?.friendlyName : undefined;

        if (!parent) {
            const child = childLinks.get(node.ieeeAddr);
            parentFriendlyName = child ? nodesByIeee.get(child.target.ieeeAddr)?.friendlyName : undefined;

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

        const oppositeLink = linksByKey.get(linkKey(link.target.ieeeAddr, link.source.ieeeAddr));

        // only add Parent when Parent+Child present
        if (!(link.relationship === ZigbeeRelationship.NeighborIsAChild && oppositeLink?.relationship === ZigbeeRelationship.NeighborIsParent)) {
            processedLinks.push([link, oppositeLink]);
        }
    }

    for (const [, bestSibling] of bestSiblings) {
        const oppositeLink = linksByKey.get(linkKey(bestSibling.target.ieeeAddr, bestSibling.source.ieeeAddr));

        processedLinks.push([bestSibling, oppositeLink]);
    }

    for (const [link, oppositeLink] of processedLinks) {
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
