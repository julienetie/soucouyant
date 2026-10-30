
# Soucouyant - (work in progress)

<img align="center" src="https://github.com/user-attachments/assets/60e17077-a633-4791-b0b8-59e7c46b962c" width="600">

## Relational State Management

Soucouyant is a powerful JavaScript state management library. It comes in two flavours **_Kiss_** and **_Enchilada_**. Common state management requirements should prefer the Kiss variant. The full variant can be ideal for persistent state management .e.g _(Undo/ Redo history)_ and trajectories e.g. _(Advanced animations)_. 

Although Soucouyant is a full featured state management system, please remember  there are no brownie points for over-engineering your application. **Please respect simplicity as a first principle**.

#### Install
##### npm

`npm i soucouyant`

##### git

Set the vendor flag to the name of your third party 
```
git clone git@github.com:julienetie/soucouyant.git \
&& npm run install --prefix soucouyant --vendor='./vendor'
```
This command puts the soucouyant builds into your specified `--vendor` folder and deletes the ./sououyant folder after.  

##### deno
```js 
export { o, pending, republish, alias, head, chain, mutex } from 'soucouyant.js'
```

#### Soucouyant Kiss
The Kiss build _(keep it simple stupid)_ features publish, subscribe, inversion and finite state abilities. It's a small but powerful state management API for applications that do not need to persist state-change. `soucouyant.kiss.min.js` is under 1kB.
```html 
<script type="module" src="soucouyant.kiss.min.js"></script>
```
#### Soucouyant Enchilada
Soucouyant Enchilada features the complete API which includes persistent state, persistent storage, finite-state trajectories, and the ability to archive state (e.g. send to the server).  `soucouyant.min.js` is under 3kB.
```html 
<script type="module" src="soucouyant.min.js"></script>
```
```html
<!-- Legacy non-module support (Does not support ES5)
<script src="soucouyant.umd.js"></script> -->
```
#### Import
```js 
// Kiss Native
import {o, pending, republish, mutex } from './soucouyant.kiss.js' 
/* Kiss Bundler 
import {o, pending, republish, mutex } from 'soucouyant/kiss' */
```
```js 
// Enchilada Native
import { o, pending, republish, alias, head, chain, mutex } from './soucouyant.js'
/* Enchilada Bundler
import { o, pending, republish, alias, head, chain, mutex } from 'soucouyant' */
```
```js 
// Enchilada CJS
const { o, pending, republish, alias, head, chain, mutex } = require('soucouyant.umd.js')
```
### [Get Started](https://github.com/julienetie/soucouyant/blob/main/GET_STARTED.md)
## [Soucouyant API Documentation](https://github.com/julienetie/soucouyant/blob/main/DOCUMENTATION.md)


_Arwork by [Alexandra Guardia](https://www.deviantart.com/alexndhearted)_

MIT © Julien Etienne 2024
