# Express Caching Middleware

Add cache support to your Express application. Supports in-memory and
Redis-based caching out of the box.

## Install
> This module has a peer dependency of `@irrelon/emitter` which is also
> installed by this command:

```
npm i @irrelon/cache-express @irrelon/emitter
```

## Usage
Add the `expressCache()` function before your route handler function.

### In Memory Cache
```typescript
import express from "express";
import {expressCache, MemoryCache} from "@irrelon/cache-express";

const app = express();
const inMemoryCache = new MemoryCache();

// Apply the caching middleware to a route
app.get(
	"/api/data",
	expressCache({
		cache: inMemoryCache
		/*options*/
	}),
	// Your route handler function
	(req, res, next) => {
		res.send("hello!");
	}
);
```

### Redis Cache
```typescript
import {createClient} from "redis";
import express from "express";
import {expressCache, RedisCache} from "@irrelon/cache-express";

const redisClient = createClient({url: "redis://localhost:6380"});

const app = express();
const redisCache = new RedisCache({client: redisClient});

// Apply the caching middleware to a route
app.get(
	"/api/data",
	expressCache({
		cache: redisCache
		/*options*/
	}),
	// Your route handler function
	(req, res, next) => {
		res.send("hello!");
	}
);
```

### Options

See the [ExpressCacheOptions.ts](src/types/ExpressCacheOptions.ts) type which describes the options available.

#### Example Usage

```javascript
import express from "express";
import expressCache from "cache-express";

const app = express();

// Apply caching middleware with custom options
app.get(
	"/api/data",
	expressCache({
		timeOutMins: 1, // Cache for 1 minute
	}),
	(req, res) => {
		// time consuming api or database calls
		let data = { success: true };
		res.json(data);
	}
);

// Or you can create a middleWare configuration beforehand:
let postsCache = expressCache({
	timeOutMins: 1,
});

// Then use it in route.
app.get("/api/posts", postsCache, (req, res) => {
	//...
	res.send("");
});

app.listen(3000, () => {
	console.log("Server is running on port 3000");
});
```

#### Examples

1. Basic Usage:

   ```javascript
   import express from "express";
   import expressCache from "cache-express";

   const app = express();

   app.get("/api/data", expressCache());

   app.listen(3000, () => {
   	console.log("Server is running on port 3000");
   });
   ```

2. Custom Timeout and Callback:

   ```javascript
   app.get(
   	"/api/data",
   	expressCache({
   		timeOutMins: 1, // Cache for 1 minute
   	})
   );
   ```

## License

This project is licensed under the [MIT License](LICENSE).
