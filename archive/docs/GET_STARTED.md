# Get Started


## Installation and importing
You can find installation details in the [README.md](https://github.com/julienetie/soucouyant/blob/main/README.md) file. _(Soucouyant does not support ES5)_. Soucouyant supports all browsers versions that support the ☆structuredClone API.

## Examples
### The classic counter

```js
// 1
o`arithmetical > counter`(0)
// 2
const varyCounter = increment => o.arithmetical.counter(state => increment + state)
// 3
varyCounter(1)                                             // Increment  by 1
// 4
varyCounter(-1)                                            // Decrement  by 1
```


1. The template literal string next to the `o` is the "address" which has `arithmetical` as a "namespace" and 
`counter` as the "stateObject". The inital value of `counter` is set to 0. 

                                    
2. In `counter(state => increment + state)` we: 
   - Obtain the current state argument
   - Add the increment to the current state
   - Then return the new value. Returning a value in `counter(()=> newValue)` sets the new state value.

3. `varyCounter()` is a shorthand wrapper so we can reuse the stateObject with different values. By calling with `1` we are adding 1 to the current state.
4. By adding `-1` we subtract 1 from the current state. 

### Publish/ Subscribe (Pub/Sub)
```js
// 1. Declare the stateObject `say`
o`people > shellyAnn > say`()

// 2. Subscribe to `say`
o.people.shellyAnn.say.sub(({state}) => {
  console.log(state)
},'speak')

// 3. Publish "Hello" to `say`
o.people.shellyAnn.say('Hello')                          // Logs "Hello"

// 4. Publish `World` to `say`
o.people.shellyAnn.say('World!')                         // Logs "World!"

// 5. Publish `Hello World!` to `say`
o.people.shellyAnn.say(state => `Hello ${state}`)        // Logs "Hello World!"
```
1. This is similar to the counter example except:
    - There are now two namespaces `people` and `shellyAnne`. `say` is the stateObject. 
    - The inital state is set with no value which means the state is implicitly `unknown`

2. We can subscribe to Shelly-Ann's `say` method using the subscribe method `.sub`. Every time a new state is published to `say` the `say.sub` callback will fire.
3. If you don't need to perform any logic, you can set the new state without a function. 
4. ""
5. Just like the counter example, we can take the current state and use it to manifest a new state.  

### Finite State

### Inversion

## Enchalada Examples

### Trajectory 

### Undo/Redo

### Sprite animation controls

### Persistent storage

### Remote storage
