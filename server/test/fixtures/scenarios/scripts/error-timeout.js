// @scenario: error-timeout
const everything = figma.currentPage.findAll(() => true); // @hang-here
return { count: everything.length };
