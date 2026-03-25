# Express Cache Middleware Flow

```mermaid
flowchart TD
    START([Request arrives]) --> GEN_KEY[Generate cacheKey from URL or req.cacheHash]
    GEN_KEY --> EVAL_SHOULD_GET[Evaluate shouldGetCache]
    EVAL_SHOULD_GET --> CHECK_NO_POOL_HDR{x-cache-do-not-pool\nheader = true?}

    CHECK_NO_POOL_HDR -->|Yes| HAS_POOL_NP{Pool exists for\nthis cacheKey?}
    HAS_POOL_NP -->|Yes| TRY_CACHE_NP[cache.get cacheKey]
    TRY_CACHE_NP --> NP_HIT{Cache hit?}
    NP_HIT -->|Yes| RESPOND_NP[Respond with cached data]:::hit --> DONE([End])
    NP_HIT -->|No| SHOULD_GET{"shouldGetCache\nreturned true?"}
    HAS_POOL_NP -->|No| SHOULD_GET

    CHECK_NO_POOL_HDR -->|No| SHOULD_GET

    SHOULD_GET -->|No| MISS_REASON_1[Record miss reason\nSHOULD_GET_CACHE_FALSE\nor custom string] --> CACHE_MISS
    SHOULD_GET -->|Yes| CACHE_LOOKUP[cache.get cacheKey]

    CACHE_LOOKUP --> CACHE_HIT{Cache hit?}
    CACHE_HIT -->|Yes| RESPOND_HIT[respondWithCachedResponse\nx-cache-result: HIT]:::hit
    RESPOND_HIT --> HEADERS_SENT_1{res.headersSent?}
    HEADERS_SENT_1 -->|Yes| ERR_HEADERS_1[Log error:\nheaders already sent]:::error --> DONE
    HEADERS_SENT_1 -->|No| SEND_CACHED_1[Send cached body\nwith cached status code] --> DONE

    CACHE_HIT -->|No| CACHE_MISS[Record miss reason]

    CACHE_MISS --> FIRE_MISS[Fire onCacheEvent MISS]
    FIRE_MISS --> POOL_CHECK{Pooling enabled AND\ninFlight cacheKey exists?}

    %% ===== POOLED PATH =====
    POOL_CHECK -->|Yes: Join pool| JOIN_POOL[Register emitter.once\nlistener on cacheKey]
    JOIN_POOL --> SET_TIMEOUT[Start requestTimeoutMs\ntimer default: 20s]
    SET_TIMEOUT --> WAIT_POOL{Waiting for pool\nresolution...}

    WAIT_POOL -->|Pool leader emits| POOL_RESOLVED[clearTimeout\nrespondWithCachedResponse\nx-cache-result: POOLED]:::hit
    POOL_RESOLVED --> HEADERS_SENT_P{res.headersSent?}
    HEADERS_SENT_P -->|Yes| ERR_HEADERS_P[Log error:\nheaders already sent]:::error --> DONE
    HEADERS_SENT_P -->|No| SEND_POOLED[Send pooled body] --> DONE

    WAIT_POOL -->|Timeout fires| POOL_TIMEOUT[Remove listener\nfrom emitter]:::error
    POOL_TIMEOUT --> SEND_504[Respond 504\nREQUEST_TIMEOUT]:::error --> DONE

    %% ===== LEADER PATH =====
    POOL_CHECK -->|No: Become leader| SET_INFLIGHT[Set inFlight cacheKey = true\nif pooling enabled]
    SET_INFLIGHT --> PATCH_RES[Monkey-patch\nres.send and res.json]
    PATCH_RES --> CALL_NEXT[next - route handler runs]

    CALL_NEXT --> HANDLER_SEND{"Route handler calls\nres.send() or res.json()"}

    HANDLER_SEND --> STORE_CACHE[storeCache called]
    STORE_CACHE --> SHOULD_SET{"shouldSetCache\nreturns true?\ndefault: status 2xx only"}

    SHOULD_SET -->|No| RESOLVE_POOL_NO_STORE[resolvePool:\ndelete inFlight\nemit to pooled listeners]
    RESOLVE_POOL_NO_STORE --> FIRE_NOT_STORED[Fire onCacheEvent\nNOT_STORED] --> ORIGINAL_SEND

    SHOULD_SET -->|Yes| BUILD_CACHED[Build CachedResponse\nbody + headers + statusCode]
    BUILD_CACHED --> CACHE_SET[cache.set cacheKey\nwith TTL from timeOutMins]
    CACHE_SET --> CACHE_SET_OK{cache.set\nsucceeded?}
    CACHE_SET_OK -->|Yes| FIRE_STORED[Fire onCacheEvent STORED] --> RESOLVE_POOL_STORED
    CACHE_SET_OK -->|No| FIRE_UNAVAIL[Fire onCacheEvent\nNOT_STORED:\nCACHE_UNAVAILABLE]:::error --> RESOLVE_POOL_STORED

    RESOLVE_POOL_STORED[resolvePool:\ndelete inFlight\nemit to pooled listeners] --> ORIGINAL_SEND

    ORIGINAL_SEND[Call original res.send/res.json\nx-cache-result: MISS] --> DONE

    %% ===== POTENTIAL ISSUE: POOL NEVER RETURNS =====
    CALL_NEXT -.->|Route handler hangs:\nnever calls res.send/res.json| NEVER_RESOLVE:::danger
    NEVER_RESOLVE["⚠ POTENTIAL ISSUE\ninFlight stays true forever.\nPool followers get 504 after timeout,\nbut NEW requests keep joining\na pool that will never resolve.\nThe leader connection also hangs\nuntil Express/HTTP timeout."]

    %% ===== ERROR PATH (not a stuck-pool issue) =====
    CALL_NEXT -.->|Route handler throws| ERR_HANDLER[Express error middleware\ncalls res.send/res.json]
    ERR_HANDLER --> STORE_CACHE

    %% Styling
    classDef hit fill:#2d6a2d,color:#fff,stroke:#1a4a1a
    classDef error fill:#8b2020,color:#fff,stroke:#5a1010
    classDef danger fill:#cc7000,color:#fff,stroke:#994400
```

## Potential Issue: Pool Never Returns

There is **one scenario** where the pool can get permanently stuck:

### Route handler hangs and never calls `res.send()` / `res.json()`

If the downstream route handler (invoked via `next()`) never sends a response — due to a hang, infinite loop, deadlock, or simply forgetting to respond — then:

- `storeCache()` is never called
- `resolvePool()` is never called
- `inFlight[cacheKey]` is **never deleted**
- The emitter event for `cacheKey` is **never fired**

**Consequence:** Pool followers that are already waiting will correctly time out after `requestTimeoutMs` (default 20s) and get a 504. However, **new requests** that arrive after those timeouts will still see `inFlight[cacheKey] === true` and join a pool that will never resolve. Each new joiner will wait `requestTimeoutMs` then 504, indefinitely, until the process restarts.

The pool leader's own connection will hang until Express or the HTTP server's own timeout closes it (which does **not** clean up `inFlight`).

### What about thrown errors?

If the route handler throws, Express's error middleware will typically call `res.send()` or `res.json()` to send an error response. Since these are the **patched** versions, `storeCache` and `resolvePool` fire normally and the pool resolves. This is not a stuck-pool scenario.

### Suggested mitigations

- **Add a `res.on("close")` or `res.on("finish")` listener** in the leader path that cleans up `inFlight[cacheKey]` and emits to the pool if `resolvePool` was never called. This covers all edge cases (timeouts, aborted connections, hangs).
- **Alternatively, add a leader-side timeout** that calls `resolvePool` and cleans up `inFlight` if the route handler doesn't respond within `requestTimeoutMs`.
