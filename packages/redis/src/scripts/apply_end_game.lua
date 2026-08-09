-- Atomic verify + mutate for EndGame — the missing half of CLAUDE.md's
-- "Game-end condition": apply_turn_tile.lua (bank hits 0) and
-- apply_submit_word.lua (each WordPlayed while the idle countdown is
-- running) already set/reset endGameDeadline; this script is what actually
-- flips status to 'ended' once a client observes that deadline has passed.
--
-- KEYS[1] state, KEYS[2] seq, KEYS[3] cmds
-- ARGV[1] commandId, ARGV[2] now (ms), ARGV[3] cmds TTL (s)
--
-- Returns either the resulting GameState JSON, or {"error": "<code>"}.

local stateRaw = redis.call('GET', KEYS[1])
if not stateRaw then
  return cjson.encode({ error = 'GameNotFound' })
end

local alreadySeen = redis.call('SADD', KEYS[3], ARGV[1]) == 0
redis.call('EXPIRE', KEYS[3], ARGV[3])
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

local now = tonumber(ARGV[2])
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
return encoded
