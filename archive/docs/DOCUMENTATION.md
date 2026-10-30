# Soucouyant API Documentation

## Index
- ### [o](#o)
   - [Declare](#declare)
   - [Finite State](#finite-state)
   - [Accessor](#accessor)
   - [o.config()](#oconfig)
   - [Configuration](#configuration)
   
- ### [stateObject](#stateobject)
   - [Get](#get)
   - [Publish](#publish)
   - [stateObject.sub()](#stateobjectsub)
   - [stateObject.unsub()](#stateobjectunsub)
   - [stateObject.offset()](#stateobjectoffset)
   - [stateObject.purge()](#stateobjectpurge)
   - [stateObject.startTime()](#stateobjectstarttime)
   - [stateObject.trailLimit()](#stateobjecttraillimit)
   - [stateObject.trajectory()](stateobjecttrajectory)

- ### [head](#head)
   - [head.startTime()](#headstarttime)
   - [head.meta()](#headmeta)
   - [head.seek()](#headseek)
   - [head.ignoreFrame](#headignoreframe)
 
- ### [chain](#chain)
   - [chain.purge()](#chainpurge)
   - [chain.trailLimit()](#chaintraillimit)
   - [chain.autoLimitTail()](#chainautolimittail)
   - [chain.tailSliceSize()](#chaintailslicesize)
   - [chain.requestTailSlice()](#chainidbrequesttailslice)
   - [chain.IDBTailSliceSize()](#chainidbtailslicesize)
   - [chain.IDBRequestTailSlice()](#chainidbrequesttailslice)
   - [chain.expose()](#chainexpose)
   - [chain.validate()](#chainvalidate)
   - [chain.find()](#chainfind)
   - [chain.buffer](#chainbuffer)

- ### [mutex](#mutex)
   - [mutex.lock()](#mutexlock)
   - [mutex.unlock()](#mutexunlock)

- ### [Types](#types)
   - [Restricted Top-level Types](#restricted-top-level-types)
   - [Structured Types](#structured-types)
   - [Subscription Types](#subscriptiontypes)
- ### [alias](#alias)
- ### [freeze](#freeze)
- ### [Logging](#)
---

>## Terminology
> Key 
>     - foo-baz = A term
>     - fooBaz = A term which is also an instance or method of Soucouyant
> 
>- **[stateObject](#)**: A function that represents part of your codebase that can change state.  
> - **state**: The form of a particular _stateObject_. State cannot be `undefined` or `NaN` and must comply with the [Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm#supported_types) 
> - **[stateChange](#')** A record that represents the change  of state of a particular _stateObject_. _stateChange_ contains the changed state's value, the timestamp of the change and relational metadata. Invariable state will create _stateChange_.
> - **[sub](#)**: _(Short for subscribe)_ subscribes a callback to action on _stateChanges_ for a particular _stateObject_.
> - **[unsub](#)**: _(Short for unsubscribe)_ unsubscribes a subscribed callback from a particular _stateChange_.
> - **Get**: Gets the current-state of a particular _stateObject_.
> - **Publish/ Set**: Set new state to be stored which also triggers subscription callbacks. 
> - **[republish](#)**: Republishes the current-state but does not create a new record in the store.
> - **current-state**: The last set state value from the position of the head
> - **inital-state**: The default state from the beginning of time. This can also be `pending`
> - **subscription-reference**: The reference of a stateObject's subscription
> - **Persist**: Record stateChange over time. See [persist](#)
> - **[pending](#)**: A symbol that represents state that may not be known until runtime
> - **[Finite State](#)**: State from a fixed selection of states.
> - **progressiveCallback**: A subscription-callback that acts in forwards time-travel. 
> - **invertedCallback**: A subscription-callback that acts in reverse time-travel.
> - **Structured**: Refers to types and data structures supported by the Structured Clone Algorithm with the exception of top-level usage of `NaN` and `undefined` 


## O
`o` is the Object Accessor which allows you to both create and access stateObjects. 
### Declare 
```js
o`address`(state)
```
- address 		 `string`
- state				 `Structured`
- Return			 `o`

The `o` [tag function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#tagged_templates) allows you to:
- Declare a new _stateObject_
- Define the initial state of the new _stateObject_ 

The address is made up of a _namespace_ or _namespaces_ followed by the _stateObject_ separated using the ` > ` delimiter.
```js 
o`images > trees > showBaobab`(false)
``` 
If not state is provided, the default argument will be set as [pending](#pending).
 ```js 
o`images > trees > dragonBloodUrl`()		// pending 
``` 

`o``()` returns it's self to enable chaining of multiple defined states. This allows you to easily define multiple states in a dedicated file/s ([State Tree](#statetree)) or at the top of each module. Soucouyant is opinionated in regards to where you structure your states. 

### Finite State
Finite state allows you to create a _stateObject_ with a fixed, limited number of states using an [Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array), [Set](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set) or [WeakSet](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakSet) with data structures that adheres to the [Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

##### Set
```js
const colours = new Set(['peachpuff', 'crimson', 'lime', 'indigo'])
o`colourPallet > colourChoices`('lime', colours)
```
#####  Array
```js
o`colourPallet > colourChoices`('green', ['red', 'green', 'blue'])
```
##### Pending
```js
o`colourPallet > colourChoices`(pending, ['palegoldenrod', 'cadetblue', 'antiquewhite'])
```

### Accessor
`o` is the root property accessor for accessing a _stateObject_ via object notation.
```js 
o.images.trees						// typeof object
o.images.trees.dragonBloodUrl 		// typeof function 
```
By default, **addresses are limited to a depth of 4 namespaces** to prevent unmanageable scenarios. If necessary this can be overridden using [.config](#config).



### o.config()
Configure Soucouyant for project requirements.
```js
o.config(configuration)
```
- configuration 		`object`

### Configuration
```js
/* Options				Default						Description 						*/
{
   allowNaN: 			false,			            // Allow NaN values
   namespaceDepth: 		4, 							// 0 to Infinity
   persist: 			false,						// Capture state over time
   databaseName: 		'soucouyant', 				// Indexeddb database name
   objectStoreName: 	'transient-state', 	        // Or 'persistent-state' if enable
   execution: 			'async-frame',				// async-queue | async-frame | sync
   mergeFidelity: 		'200ms',					// Time ms | index offset 
   offlineStorage: 	{
      mode:				'disabled'					// disabled | all | excess
      excessLimit: 		''							// frames/ time / Infinity
   }
}
```

## stateObject()
A stateObject takes an optional callback function.
```js
~.stateObject(callback) 		// You can `Get` or `Publish` state by using a callback   
~.stateObject() 		   		// This will `Get` the current-state and return it 
```
### Get
Since all _stateObjects_ have an initial state, we can obtain the current-state by calling the _stateObject_ without arguments.
```js
const colour = o.octopodes.caribbeanReef.colour() // "aquamarine" 
```
Returning a value within the callback will set the new state. To avoid this we can: 
- Not return a value
- Return `undefined` 
- Return with the `void` keyword or `void()` function.
This allows us to compose actions within the callback if needed. 
```js
o.witches.loogaroo.shapeshift(state => void transformCurrentShape(state))
```
It's important to return `void` or `undefined` if you do not want to update the current state.

###  Publish
To change the current state value you must return a new value within the stateObject's callback.
```js
// E.g.
o.octopodes.caribbeanReef.colour('turquoise')

// E.g.
o.octopodes.common.colour(()=> {
 return 'indianred'
})

// E.g.
o.offsets.left(state => state + 100) 
```
### stateObject.sub()
Subscribes to the changes of a stateObject 
```js
o.button.sub(callback, ref)
```
- callback `function` - The triggered action when a stateObject is published
- ref `string` - The subscription reference

#### Dynamic Arguments 
`.sub(callback)` can provide you with different values depending on the syntax you provide in the callback's arguments. 

To obtain the state as a single argument simply provide a single argument. 
`~.sub(state => {})`

To access props from the subProps use a destructured object. 
`~.sub(({state, rev, direction}) => {})` 

To access the subProps object, use the word `subProps` as a single argument (subProps is a reserved argument)
```
~.sub( subProps => {
  console.log(subProps.timestamp)
})
``` 

#### Subscription Props 
The callback provides a single object argument `subProps` which should ideally be destructured.

- **state**: The changed state
- **identity**: The internal identity of the stateObject
- **timestamp**: The timeStamp of the new state change
- **fwd**: The next state if available
- **rev**: The preceding state if available
- **states**: Finite states, available for finiteStateObjects (Array, Set, Weakset) 
- **finiteIndex**: The current index position of the finite state
- **index**
- **offset** 
- **timeOffset**
- **direction**

#### Directional behaviour 
With Soucouyant, time _(head)_ can travel forwards or backwards.  
If time travels forwards or backwards in time the callback will fire with corresponding `subscriptionProps`. 
```js
o.counter.sub(({direction}) => console.log('Going: ', direction), 'log-direction')
head.seek('fwd')
// Going: fwd
head.seek('rev')
// Going: rev
```
#### Inversion
When two callbacks are defined the first is the _proceeding_ callback and the 2nd is the _inverted_ callback. 
In theory, the inverted callback would typically represent the reverse action of the proceeding callback.
The last two arguments represent the callback's _subscription-references_ respectively.
e.g. 
- Car drives forward = _proceeding_
- Car drives in reverse = _inverted_
```js
o.car.drive.sub((subscriptionProps) => {
   // Drive forward
}, (subscriptionProps) => {
   // Drive in reverse 
}, 'drive-forward', 'drive-in-reverse')
```
- proceedingCallback `function` - The forwards action
- invertedCallback `function` - The reverse action
- ref1 `string` - The proceeding subscription-reference
- ref2 `string` - The inverted subscription-reference

### stateObject.unsub()
Unsubscribe from  changes to a stateObject
```js
o.stateObject.unsub(ref)
o.stateObject.unsub(...refs)
```
- ref `string` - A subscription-reference

### stateObject.offset()
Offsets the execution of the stateObject to the offset frame. This does not modify the head.
```js
o.stateObject.offset(7)
```

### stateObject.purge()
Manually clears states ahead of the head. 
```js
stateObject.purge() // Purge
stateObject.purge('auto') // Auto-purge   
stateObject.purge('auto-stop') // Stop auto purge 
```

### stateObject.startTime()
The start-time when the state-object was first initiated.

### stateObject.trailLimit()
Limits the number of states that can be recorded by index, time.  

### stateObject.trajectory()
Define and manage the trajectory of a finiteStateObject.

```js 
o.player.one.controllsDirection.trajectory({
	order: ['up','right', 'down', 'left'], // The order states should be progressed, order is optional
	continuation: 'loop' // loop | rebound | end | random | random-unique,
	intervals: 1000, // Use the name of the property in each finite-state object that represents the ms 
	keyframeActions: false
})

o.player.one.controllsDirection.trajectory.fwd() // Move head forward
o.player.one.controllsDirection.trajectory.rwd() // Move head backwards
o.player.one.controllsDirection.trajectory.play() // Plays with interval
o.player.one.controllsDirection.trajectory.pause() // Pause trajectory
o.player.one.controllsDirection.trajectory.stop() // Stops and moves head to start of trajectory
o.player.one.controllsDirection.trajectory.reverse() // Inverse of play (Inversion)
o.player.one.controllsDirection.trajectory.seek(index)  // go to index 
```
#### Keyframe Actions
Keyframe Actions allow you to define the action of trajectory stateChanges within each item of a finite-State dataset. This means that you can assign a callback (`action`) to each state and define how you want that action to behave. (This is ideal for keyframe animations)

You can enable keyframe callbacks in the trajectory object by setting `keyframeActions` to true.
This may seem like the Structured Clone Algorithm rules are being bent but this is what's going on:

1. Your finite dataset (Array, Set or WeakSet) is a collection of object literals with the following mandatory properties:  
```js
{
  state: /* Structured */,
  duration: /* number ms */,
  startDelay: /* number ms */,
  endDelay: /* number ms */, 
  action: stateProps | state => {},
  custom1: /* any */,
  custom2: /* any */,
  custom3: /* any */
}
```
2. Each `action` property is replaced with the name of the function. Each function should have a `Function.prototype.name` defined.
3. Functions are stored in an internal WeakMap against their names.
4. Only `state` is stored in the main-chain but with an index called `finiteIndex` which represents the finite-state that created it.
5. Additional custom properties are available to the action callback.

Therefore the data stored is still Structured and not polluted by functions.
```
You can use subscriptions in conjunction with keyframe actions. 


## head
Think of the head as being similar to a VCR or cassette player head in the sense that the head represents the current play position and your application can traverse back or forth throughout the entire recording. One difference is that as more states are added, by default the head will move and keep up with each newest state (this resembles new commits in git).

In Soucouyant we refer to timelines as chains. The main chain is the **head-chain**. The head-chain allows us to time-travel as well as carry out responsibilities relating to browser storage and remote storage.

### head.startTime()
Returns a timestamp of the start time when Soucouyant was initialised.
```js
const startTime = head.startTime() // timestamp ms
```

### head.meta()
Returns the current **index** and **timestamp** of the currentState
```js
head.meta()
```
```js
{
   timestamp: number, 
   index: number,
   isHeadPresent: boolean, 
   getCurrentFrame: function
}
```

### head.seek() 
Jump to a particular timestamp, index or the state of a specified value.
Seek traverses the timeline to time-travel.
- `'>3' '<4'`forward/ backwards by n  amount from current
- `4786347` Jump to exact frame timestamp or nearest neighbour  
- `8`Jump to the exact frameIndex
- `first`Jump to first index 
- `present`Jump to last index
- `fwd`
- `rev`

### head.ignoreFrame()
Ignores a given frame by frameId, index or timestamp 
```js
 head.ignoreFrame(frameid | timestamp | name) // ignore a given frame
 head.ignoreFrame(frameid | timestamp | name, 'stop') // Stop ignoring frame
```

Enabled the future to be preserved 
### chain.purge()
Manually clears states ahead of the head. 
```js
chain.purge() // Purge
chain.purge('auto') // Auto purge
chain.purge('stop-auto') // Stops auto perge
```

### chain.trailLimit()
Limits the number of frames that can be recorded by index, time.

### chain.autoLimitTail()
Limit the amount of state recorded by index or  time
```js 
chain.autoLimitTail() // Auto limit tail
chain.autoLimitTail('idb') // Auto limit tail IDB
chain.autoLimitTail('stop') // Stop autoLimitTail
```

### chain.tailSliceSize()
Determines how big each slice should be before requestTailSlize is called. 
```js
chain.tailSliceSize(10) // called on every 10 frames
``` 

### chain.requestTailSlice()
A callback for sending data before it's cllipped by `autoLimitTail()` 
```js
chain.tailSliceSize(2)
chain.requestTailSlice(slice => {
	// Send slice to server
})
```

### chain.IDBTailSliceSize()
Determines how big each slice should be before `IDBTrequestTailSlice` is called. 
```js
chain.tailSliceSize(10) // called on every 10 frames
``` 

### chain.IDBRequestTailSlice()
A callback sending or managing data before it's cllipped by `autoLimitTail()` 
```js
chain.tailSliceSize(2)
chain.IDBRequestTailSlice(slice => {
	// Send slice to server
})

chain.IDBRequestTailSlice(slice => {
	// Send slice to server
}, ...stateObjects)
```
- stateObject `string` - Filter by stateObject/s

### chain.expose()
Exposes the main-chain for manipulation and mutation 
```js
const mainChain = chain.expose() // Array
```

### chain.validate()
Throws an error if a given chain is invalid
```js
chain.validate(modifiedChain) // undefined
```

### chain.find()
Return the frame of the state's name, index or timestamp.
```js
chain.find(alias) // Gets state value 
```

### chian.buffer()
When state is published to an unlocked chain, it writes directly to the chain. 
If state is being published to the locked chain, it will be queued in the buffer.
Once the chain is unlocked the next state to be written will write to the chain.  


## alias()
Optionally assign an alias to a particular returning state.
```js 
alias(id, value)		// object-alias 
/*
- typeof id			-	string
- typeof value		- 	Structured types, except undefined and NaN
```
E.g.
```js
return alias('opened-state', value)
``` 

## freeze()
Freeze protects the _stateObject_'s address from modification.
```js
// o.one.two.three.four.greeting()
freeze(o.one.two.three)				
```
In the above example `freeze` will prevent `one`, `two` and `three` from adding or removing _stateObjects_ but more stateObjects can be added to `four`.

```js
// o.a.b.c.d.farewell()
freeze(o)				
```
In this scenario, no more namespaces can be added to `o` but more namespaces and stateObjects can be added to `a`, `b`, `c` or `d`.

## Types 

### Restricted Top-level Types
Soucouyant allows for state to be of any types or data structures that adheres to the [Structured Clone Algorithm](#) with the exception of top-level use of:
- `undefined`
- `NaN`
 
Although you can get around these restritions by wrapping the values in objects, these restraints can be used to reduce errors.

- Publishing state as `undefined` will be ignored and will not trigger stateChange. 
- Publishing state as `NaN` will be ignored, will not trigger stateChange but will log an error.


### Structured Types
With the exception of Restricted Top-level Types, states should match the types and data structured of the [Structured Clone Algorithm](#). 
Invalid types and data structures will trigger a [DataCloneError](#) by the internal `structuredClone` method.


### Subscription Symbols
Soucouyant is a rich state management library wihich was intentinally aimed at covering various edge cases in a minimalistic fashion.
Some of these edgecases involve limitations by data-types. Subscription Symbols are types of state definitions for Soucouyant to understand the intention of the implementor where the data-type cannot. 

- #### `pending`
  When the initial state is not known until runtime. 
  - It's set internally as the inital state when a stateObject is defined without an inital state.
  - When published at runtime, it triggers subscriptions with the pending property in the object argument for managing pending state.
  -`pending` represents the beginning of an upcoming stateChange. Therefore it is stored as a stateChange on the main-chain. 

- #### `republish` 
  Republish will trigger subscriptions with the last state
  - `republish` can ony be used with`mutex.lock()`
  - Republish will not add a new stateChange to the chain

## mutex

### mutex.lock()
Prevents the main-chain or stateObject's chain from being written over by other calls to the chain.
The mutex will unlock automatically when the stateChange is made by the call in question.
```js
mutex.lock(stateObject) 		// Locks a particular stateObject's chian 
mutex.lock(chain)			// Locks the main-chain
```

### mutex.unlock()
There is no need to unlock a chain unless the chain needs to be freed earlier than the stateChange in question, or if the state change is no longer required.
```js
mutex.unlock(stateObject) 		// unlocks a particular stateObject's chain 
mutex.unlock(chain)			// unlock the main-chain
```

## Logging
### Observe, tree(),  table()
You can reduce or eliminate your usage of console logging methods in your codebase by defining `observe` in the configuration. Observe can:
- Log details of a stateChange:
- Log a non-change 
- Log trajectory navigation calls 
- Log timestamps 
- Logs mutex state and the chain-buffer 
Observe has 3 levels: 
- `minimal`, `moderate`, `verbose` 

`tree()` and `table()` can be used to visualise state data as trees and tables.
```js
tree(o)
tree(stateObject.trajectory)
table(stateObject.trajectory)
tree(stateObject)
table(stateObject)
tree(chain)
table(chain)
tree(chain, alias)
table(chain, ...aliases)
```
