// @scenario: long-running
await new Promise((resolve) => setTimeout(resolve, 60000));
return { slept: true, mutatedNodeIds: ["10:4"] };
