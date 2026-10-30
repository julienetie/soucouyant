// o for StateObject
// finite for finite state machine

// By array, primitives only
finite`cat1 > cat2 > cat3`(['menu', 'home', 'about', 'contact', 'faq']) // default is 'menu'

finite`cat1 > cat2 > cat3`(['menu', 'home', 'about', 'contact', 'faq'], 'home')  // default is 'home'
// The first value will be default if a default is not set.
// Default can be pending 
// A key can be pending 
// An array cannot contain duplicate values

// Sets do not have the abilty to seek by index


// You can set the state as normal
finite.cat1.cat2.cat3('about')

// and get the state as normal 
finite.cat1.cat2.cat3(state => console.log(state))

// Actions are done using sub just like stateObjects
finite.cat1.cat2.cat3.sub(forwardsFn)
finite.cat1.cat2.cat3.sub(forwardsFn, reverseFn)
finite.cat1.cat2.cat3.sub(forwardsFn, activeFn, reverseFn) // Fwd = forwardsfn -> active Fn, Rwd = reverseFn -> activeFn


// By default forwards and reverse is determined by the direction of the finite head
// But you can also specify the direction when manually changing state 
finite.cat1.cat2.cat3.fwd('contact') // Jump to contact, execute fwd callback
finite.cat1.cat2.cat3.rwd('home')    // Jump to home, execute rwd callback
finite.cat1.fwd() // Move forward by 1
finite.cat1.rwd() // Move backwards by 1
finite.cat1.play() // Jumps to next state in trajectory by given interval 
finite.cat1.pause() // Pause trajectory
finite.cat1.stop() // stops and moves head to start of trajectory
finite.cat1.reverse() // Inverse of play, also executes reverse callbacks in the other direction
finite.cat1.seek(index | state) // Go to index or key

// You can do all of the above without the below

const orders = new Map([
	["order-a", ['up', 'right', 'down', 'left']],
	["order-b", ['left', 'right', 'down', 'down']],
	["order-c", ['down', 'right', 'up', 'down']],
])

const durations = new Map([
	["up", [200, 1000, 300]],
	["down", [400', 300]],
	["left", [200, 0, 450]],
	])

// Orders and order = optional / Uses finite order by default
// intervals = optional (defaults to 0)
// durations = required (by-wait or durations map) No async await means instant 0
// default = required 
// continuation: optional, defaults to end
//
finite.cat1.trajectory({
	normalStage: {
		continuation: 'loop', // loop | rebound | end | random | random-unique,
		intervals: 1000, // Use the name of the property in each finite-state object that represents the ms 
		order: 'order-b',
		durations
	},
	finalBoss: {
		continuation: 'loop', // loop | rebound | end | random | random-unique,
		intervals: 1000, // Use the name of the property in each finite-state object that represents the ms 
		order: 'order-a'
        durations: 'by-wait'   // Callbacks need to be await and only begin the next when the return value is recieved 
	}
})
	.config({
		default: 'finalBoss',
		orders,
	})



// Simplified 
finite.cat1.trajectory({
	normalStage: 'order-b',
	finalBoss: 'order-a'
})
	.config({
		default: 'finalBoss',
		orders,
		durations,
		continuation: 'rebound',
		intervals: 0,
		// durations: 'by-wait'   // Callbacks need to be await and only begin the next when the return value is recieved 
	})

// once the tranectory is configured it can be changed using 
finite.cat1.trajectory('normalStage')

// Allthe same applies 
finite.createChain('game')
finite.game`levels > snowLand > badGuyTwo`(['fireball', 'back', 'forwards', 'jump', 'storm'])


// To go back in time , this will not add to the progression of history
finite.head.seek('rwd')
finite.head.seek('fwd')
/* 
'>3' '<4' - forward/ backwards by n amount from current
4786347 Jump to exact frame timestamp or nearest neighbour
8 - Jump to the exact frameIndex
firstJump - to first index
present - Jump to last index
fwd
rev
	 */

Important: There must be a way to get all finite config and state settings when going back in time. 
	IF a config changes in real - time it must be recorded.

	// It can be reconfigured and reset in real time. 
	// - Object = configure 
	// - string = set

	//
	//
	// If you neeed more control you can define the logic in the main default fn witht the provided direction and last state
	/* 
	state: The changed state
	identity: The internal identity of the stateObject
	timestamp: The timeStamp of the new state change
	fwd: The next state if available
	rev: The preceding state if available
	states: Finite states, available for finiteStateObjects (Array, Set, Weakset)
	finiteIndex: The current index position of the finite state
	index
	offset
	timeOffset
	direction
	lastState: Last state 
	futureState: Next state on trajectory (if available)
	prevState: Previous state in sequence
	nextState: Next state in sequence */



	- primitives(Excluding Symbol() and undefined)
	- pending


Array = Indexed state machine
Set = Unindexed state machine


