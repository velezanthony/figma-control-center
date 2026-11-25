// @scenario: error-runtime
const total = 3;
const missing = undefined;
return missing.name; // @throw-here
