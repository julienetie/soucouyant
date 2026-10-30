# Understanding State Management

It's important that we correlate the same principles of state change in the physical world as with state change in the computing world.
This is important because we want to manage state change in software as effectively as possible.

## State change is observable and recordable
There are various devices and instruments that can observe and record state. For simplicity, we can compare state management in computing to a CCTV camera setup.

#### A single CCTV camera can typically observe the meaningful aspects of a room  
This should indicate that you typically only need a single state management system if you consider your application as the room.


#### Only record on motion detection
You don't need to record every state-change, just the meaningful ones.

#### A single storage drive can store the data recorded data
There is no need for multiple stores.

#### If the storage drive is overwhelmed data can be sent to the cloud


>#### Other
>- **No Async**: Asycronous code should be handeled manually for loose coupling using `Promise`, `async/await`, `setTimeout`, `requestAnimationFrame` etc. 
>- **No Nested or Hierarchical state**: Soucouyant believes nested state is a code-smell and should be avoided for optimal maintainablity.
>- **No middleware interface**: This is not necessary since the pub/sub nature of Soucouyant is more adequate for integrations.

*emphasized text*# Import
