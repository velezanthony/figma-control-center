// @scenario: build-step-slow
await new Promise((resolve) => setTimeout(resolve, 60000));
return { mutatedNodeIds: ["11:4"] };
