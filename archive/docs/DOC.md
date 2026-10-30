
## Types of Timelines 
There are three types of Timelines: 
- Structured Timeline: State with object types are copied using structuredClone 
- Unstructured Timeline: States with object types are referenced and can contain references
- Primitive Timeline: Limited types for fast performance, object types are stored as primitives

Allowed Types
| Types               | Structured | Unstructured | Pruned |
|---------------------|------------|--------------|--------|
| Null                | x          | x            | x      |
| Boolean             | x          | x            | x      |
| Number              | x          | x            | x      |
| String              | x          | x            | x      |
| Plain Object        | x          | x            | x      |
| Symbol              |            | x            |        |
| Arrays              | x          | x            | x      |
| TypedArrays         | x          | x            |        |
| ArrayBuffers        | x          | x            |        |
| DataView            | x          | x            |        |
| Date                | x          | x            |        |
| Regular Expressions | x          | x            |        |
| Map                 | x          | x            |        |
| Set                 | x          | x            |        |
| Error Types         | x          | x            |        |
| BigInt              | x          | x            |        |
| pending             | x          | x            | x      |
| republish           | x          | x            | x      |

Disallowed Types
| Types               | 
|---------------------|
| Undefined           |
| NaN                 |
| Classes             |
| Promise             |
| Functions           |
| WeakMap             |
| WeakSet             |
| WeakRef             |
| Circular References |
| Blob                |
| File                |
| ImageData           | 
| SharedArrayBuffer   |


The config of each timeline defines the **timelineType** which can be changed in real-time. 
It's possble to develop with Structured Timeline Type and change over to Unstructured for production
using the `.setTimelineType('unstructured')`.

There is no hard rule about what type to prefer. "Structured" is the default which will guard against
data usutiable for structured-cloned based APIs like postMessage and IndexedDB, as well as not containing references to external objects. "Unstructured" stores object without the structured-clone algorithm in some cases it may be faster 
but it may also be more privy to external references. "Pruned" is a restricted data type spcifically where performance is a concern.  
 
