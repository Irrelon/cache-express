# Express Caching Middleware

Add cache support to your Express application. Supports in-memory and
Redis-based caching out of the box.

## Install

```
npm install @irrelon/cache-express
```

## Usage
Add the expressCache() function before your route handler function.

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

The Express Cache Middleware provides several configuration options to tailor caching behavior to your specific needs:

- **`dependsOn` (optional, default: `() => []`)**: A function that returns an array of dependency values for cache checking. When any of these dependencies change, the cache for the associated route will be invalidated and refreshed.

- **`timeOut` (optional, default: `1 hour`)**: Specifies the cache timeout in milliseconds. This determines how long a cached response remains valid before it's considered expired and refreshed. If Dependency array changes, this timing will be resetted.

- **`onTimeout` (optional, default: `() => { console.log("Cache removed"); }`)**: An optional callback function that executes when a cached item expires and is removed from the cache. Use this for custom cache expiration handling.

### Example Usage

```javascript
import express from "express";
import expressCache from "cache-express";

const app = express();

// Apply caching middleware with custom options
app.get(
	"/api/data",
	expressCache({
		dependsOn: () => [getUserID()],
		timeOutMins: 1, // Cache for 1 minute
		onTimeout: (key, value) => {
			console.log(`Cache removed for key: ${key}`);
		},
	}),
	(req, res) => {
		// time consuming api or database calls
		let data = { success: true };
		res.json(data);
	}
);

//Or you can create a middleWare configuration beforehand:
let postsCache = expressCache({
	dependsOn: () => [postCount],
	timeOutMins: 1,
	onTimeout: () => {
		console.log(`Posts changed, cache removed`);
	},
});

//then use it in route.
app.get("/api/posts", postsCache, (req, res) => {
	//...
	res.send("");
});

app.listen(3000, () => {
	console.log("Server is running on port 3000");
});
```

**Dependency-Based Cache Invalidation:**

The middleware supports dependency-based cache invalidation. You can specify dependencies for your cached data, and the cache will be automatically invalidated if any of the dependencies change. This dependsOn should be **function which returns** an array that includes dependencies.

```javascript
app.get(
	"/api/data",
	expressCache({
		dependsOn: () => [value1, value2],
	})
);
```

**Examples:**

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
   		onTimeout: (key, value) => {
   			console.log(`Cache removed for key: ${key}`);
   		},
   	})
   );
   ```

3. Dependency-Based Invalidation:

   ```javascript
   app.get(
   	"/api/user",
   	expressCache({
   		dependsOn: () => [getUserID()],
   	})
   );
   ```

## License

This project is licensed under the [MIT License](LICENSE).
