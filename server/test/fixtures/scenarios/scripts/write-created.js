// @scenario: write-created
const card = figma.createFrame();
card.name = "Tarjeta";
const label = figma.createText();
return { createdNodeIds: [card.id, label.id], mutatedNodeIds: ["10:3"] };
