/** Public API: other packages call load() and read the result synchronously. */
function load() {
  return { name: 'config', version: 1 };
}

module.exports = { load };
