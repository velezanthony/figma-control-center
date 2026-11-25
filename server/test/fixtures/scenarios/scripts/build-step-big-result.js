// @scenario: build-step-big-result
const log = [];
for (let i = 0; i < 3000; i++) log.push("enlace " + i);
return { mutatedNodeIds: ["11:5"], log };
