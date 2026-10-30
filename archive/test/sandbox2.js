import { o, config, uniqueStoreManager } from '../src/prototype.js'

o()
const addItem = uniqueStoreManager.addItem('Hello World!')

const addItem2 = uniqueStoreManager.addItem(12436534576846n)

const addItem3 = uniqueStoreManager.addItem('Hello World!')
console.log('addItem', addItem)
console.log('addItem2', addItem2)
console.log('addItem3', addItem3)
