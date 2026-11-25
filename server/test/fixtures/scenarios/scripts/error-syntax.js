// @scenario: error-syntax
async () => {
	const ok = 1;
	const broken = ;  // @error-here
	return ok;
}
