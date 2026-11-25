async () => {
	await new Promise((resolve) => setTimeout(resolve, 4000));
	return { mutatedNodeIds: [], slept: true };
};
