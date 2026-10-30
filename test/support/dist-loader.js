// npm run test:dist and test:min: run the whole suite against ./dist by
// redirecting the tests' imports of ./src to the built files. Child
// processes inherit it through NODE_OPTIONS.
import { register } from 'node:module'

register('./dist-hooks.js', import.meta.url)
