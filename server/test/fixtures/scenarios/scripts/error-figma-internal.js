// @scenario: error-figma-internal
const node = await figma.getNodeByIdAsync("10:1");
node.fills = "no-es-un-array"; // @throw-here
return { mutatedNodeIds: [node.id] };
