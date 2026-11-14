import { bench, describe } from "vitest";
import { buildGraph } from "../src/components/network-page/raw-map/buildGraph.js";
import { generateNetworkMap } from "./fixtures/generateNetworkMap.js";

const OPTIONS = { showParents: true, showChildren: true, showSiblings: true, showIcons: false, childrenLabel: "Children" };

for (const size of [100, 300, 1000]) {
    const { map, devices } = generateNetworkMap(size);

    describe(`network map ${size} nodes`, () => {
        bench("buildGraph", () => {
            buildGraph(map, devices, OPTIONS);
        });
    });
}
