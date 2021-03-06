import cache from './cache';

/** 
 Accumilates frames.

**/
const accumilator = [
    []
];
const uniqueStateReferences = [];

const persistence = {
    options: {
        mergeFidelity: 0,
    }
};

const cloneObject = (value, allowSingleFunction) => {
    if(typeof value === 'function'){
        if(!allowSingleFunction){
            throw Error('Cannot copy \'[object Function]\' as \'allowSingleFunction\' is not enabled.');
        }
        return new Function('return ' + value.toString())();
    }
    if(value === undefined){
        return value; 
    }
    if(Object.is(value,NaN)){
        return value;
    }
    if(typeof value !== 'object'){
        return value;
    }
    const toParse = Array.isArray(value) ? value 
    : Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = value[key];
        return acc;
    }, {});
    
    return JSON.parse(JSON.stringify(toParse)); 
}

// Update settings.
export const persistenceSettings = options => Object.assign(persistence.options, options);


// Adds a new state to the accumilator 
// May create a new frame to do so.
export const addNewState = (state, identity) => {
    const currentTimeStamp = Date.now();
    const mergeFidelity = persistence.options.mergeFidelity;
    // Check unique states and add the state if does not yet exist.
    // Directly reference the existing state.
    const clonedState = cloneObject(state);
    const stateAsString = JSON.stringify(clonedState);
    const uniqueStateReferencesLength = uniqueStateReferences.length;

    let stateExist = false;
    let directReference;
    for (let i = 0; i < uniqueStateReferencesLength; i++) {
        const uniqueState = uniqueStateReferences[i];
        const hasExistingState = JSON
            .stringify(uniqueState) === stateAsString; 
        if (hasExistingState) {
            directReference = uniqueState;
            stateExist = true;
            break;
        }
    }

    if (stateExist === false) {
        uniqueStateReferences.push(clonedState);
        directReference = clonedState;
    }

    // Find frame by timestamp
    const accumilatorLength = accumilator.length;
    const lastFrame = accumilator[accumilatorLength - 1];
    const lastFrameTimeStamp = lastFrame[0];

    // If within proximity merge. 
    const withinMergePeriod = lastFrameTimeStamp + mergeFidelity > currentTimeStamp;
    if (withinMergePeriod) {
        // merge to last frame
        lastFrame.push([identity, directReference]);
    } else {
        // Add new frame.
        accumilator.push([
            currentTimeStamp, [
                identity,
                directReference
            ]
        ]);
    }

    // console.log('cache',cache)
    const subscriptions = cache.subscriptions;
    // Execute subscriptions
    if (subscriptions[identity] === undefined) {
        subscriptions[identity] = {};
    }
    const subIdentity = subscriptions[identity];
    const subIdentityLength = Object.keys(subIdentity).length;

    for(let ref in subIdentity){
        subIdentity[ref](directReference, identity, currentTimeStamp);
    }

    // console.log('accumilator', JSON.stringify(accumilator, null, '\t'));
}

export const getCurrentState = (identity) => {
    const accumilatorLength = accumilator.length;
    for (let i = accumilatorLength; i > -1; --i) {
        const frame = accumilator[i] || [];
        const frameLength = frame.length;
        for (let j = 0; j < frameLength; j++) {
            if (frame[j][0] === identity) {
                return frame[j][1];
            }
        }
    }
}