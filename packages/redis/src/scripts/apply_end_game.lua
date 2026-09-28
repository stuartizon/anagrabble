-- Atomic verify + mutate for EndGame — the missing half of CLAUDE.md's
-- "Game-end condition": apply_turn_tile.lua (bank hits 0) and
-- apply_submit_word.lua (each WordPlayed while the idle countdown is
-- running) already set/reset endGameDeadline; this script is what actually
-- flips status to 'ended' once a client observes that deadline has passed.
--
-- KEYS[1] state, KEYS[2] seq, KEYS[3] cmds, KEYS[4] bag (only for its TTL)
-- ARGV[1] commandId, ARGV[2] now (ms), ARGV[3] cmds TTL (s), ARGV[4] game TTL (s)
--
-- Returns either the resulting GameState JSON, or {"error": "<code>"}.

local stateRaw = redis.call('GET', KEYS[1])
if not stateRaw then
  return cjson.encode({ error = 'GameNotFound' })
end

-- Command dedup: a sorted set of commandId -> when it was seen, trimmed to
-- the last ARGV[3] seconds on every write, so each id is remembered for that
-- window however busy the game is. Not a plain set with one EXPIRE on the
-- whole key: every command refreshed that, so an active game's set never
-- expired and never shrank (anagrabble#56). Same block in every script that
-- takes a commandId, plus gameSession.ts's markCommandSeen.
local now = tonumber(ARGV[2])
local dedupWindowMs = tonumber(ARGV[3]) * 1000
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now - dedupWindowMs)
local alreadySeen = redis.call('ZADD', KEYS[3], 'NX', now, ARGV[1]) == 0
redis.call('PEXPIRE', KEYS[3], dedupWindowMs)
if alreadySeen then
  return stateRaw
end

local state = cjson.decode(stateRaw)

-- Already ended is a no-op, not an error — two clients' idle timers can
-- legitimately both fire within the same window, and the second landing
-- after the first already flipped status isn't a client bug. Same
-- reasoning as apply_turn_tile.lua's "nothing left to turn" no-op.
if state.status == 'ended' then
  return stateRaw
end

if state.status ~= 'playing' then
  return cjson.encode({ error = 'GameNotStarted' })
end

-- type() check, not truthy: lua-cjson decodes JSON null as the (truthy)
-- cjson.null sentinel, not Lua nil.
local deadlinePassed = type(state.endGameDeadline) == 'number' and now >= state.endGameDeadline
if not deadlinePassed then
  return cjson.encode({ error = 'GameNotIdle' })
end

local seq = redis.call('INCR', KEYS[2])
state.status = 'ended'
state.seq = seq

local encoded = cjson.encode(state)
-- Same players[].words empty-array patch as apply_turn_tile.lua — see that
-- script's comment for why lua-cjson needs it.
encoded = string.gsub(encoded, '"words":{}', '"words":[]')

redis.call('SET', KEYS[1], encoded)
-- Every real mutation resets the game's TTL on all its keys together, so a
-- game lives until ARGV[4] seconds after its last move (anagrabble#58) and its
-- keys never drift apart. EXPIRE on the bag is a no-op once it has emptied.
for _, key in ipairs({ KEYS[1], KEYS[2], KEYS[4] }) do
  redis.call('EXPIRE', key, ARGV[4])
end
return encoded
