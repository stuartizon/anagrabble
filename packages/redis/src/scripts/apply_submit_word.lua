-- Atomic re-verify + mutate for SubmitWord. See CLAUDE.md "Word resolution
-- implementation split" — Node already ran the full decomposition search
-- (packages/game resolveWordPlay) against a plain read of state and picked
-- the winning plan; this script's only job is the cheap atomic check that
-- nothing moved between that read and this call (each used word is still
-- owned where it was read, the pool still has those exact letters) before
-- applying it. Two clients racing to consume the same claimed word or the
-- same pool tile is exactly the race this exists to resolve deterministically.
--
-- Deliberately does NOT check whether `word` is already claimed by someone
-- (or even by this same player) — duplicate claims of the identical word
-- are allowed, as long as the letters are genuinely available each time (see
-- docs/decisions.md "Duplicate word claims are allowed"). The removal logic
-- below is count-based rather than identity-based specifically so this falls
-- out correctly: it already tolerates the same word string appearing more
-- than once in a player's `words`.
--
-- KEYS[1] state, KEYS[2] seq, KEYS[3] cmds (see gameSession.ts key builders).
-- ARGV[1] commandId, ARGV[2] submitterId, ARGV[3] now (ms), ARGV[4] cmds TTL
-- (s), ARGV[5] word (exact string to store), ARGV[6] usedWords JSON
-- (`[{"word":..,"ownerId":..}]`, as read from state at search time), ARGV[7]
-- usedPoolLetters JSON (`[".."]`, ditto).
--
-- Returns either the resulting GameState JSON, or {"error": "<code>"}.

local stateRaw = redis.call('GET', KEYS[1])
if not stateRaw then
  return cjson.encode({ error = 'GameNotFound' })
end

local alreadySeen = redis.call('SADD', KEYS[3], ARGV[1]) == 0
redis.call('EXPIRE', KEYS[3], ARGV[4])
if alreadySeen then
  return stateRaw
end

local state = cjson.decode(stateRaw)
if state.status ~= 'playing' then
  return cjson.encode({ error = 'GameNotStarted' })
end

local submitterIndex = nil
for i, p in ipairs(state.players) do
  if p.id == ARGV[2] then
    submitterIndex = i
    break
  end
end
if submitterIndex == nil then
  return cjson.encode({ error = 'PlayerNotFound' })
end

local word = ARGV[5]

local usedWords = cjson.decode(ARGV[6])
local usedPoolLetters = cjson.decode(ARGV[7])

-- Re-verify every used word is still owned by whoever it was read from.
for _, uw in ipairs(usedWords) do
  local ownerIndex = nil
  for i, p in ipairs(state.players) do
    if p.id == uw.ownerId then
      ownerIndex = i
      break
    end
  end
  local stillOwned = false
  if ownerIndex ~= nil then
    for _, w in ipairs(state.players[ownerIndex].words) do
      if w == uw.word then
        stillOwned = true
        break
      end
    end
  end
  if not stillOwned then
    return cjson.encode({ error = 'StaleState' })
  end
end

-- Re-verify the pool still has every claimed letter (exact multiset check).
local poolCounts = {}
for _, tile in ipairs(state.pool) do
  poolCounts[tile] = (poolCounts[tile] or 0) + 1
end
for _, letter in ipairs(usedPoolLetters) do
  if not poolCounts[letter] or poolCounts[letter] <= 0 then
    return cjson.encode({ error = 'StaleState' })
  end
  poolCounts[letter] = poolCounts[letter] - 1
end

-- All checks passed — apply the mutation.
local now = tonumber(ARGV[3])
local seq = redis.call('INCR', KEYS[2])

-- Consume usedPoolLetters from the pool (one occurrence per listed letter).
local toConsume = {}
for _, letter in ipairs(usedPoolLetters) do
  toConsume[letter] = (toConsume[letter] or 0) + 1
end
local newPool = {}
for _, tile in ipairs(state.pool) do
  if toConsume[tile] and toConsume[tile] > 0 then
    toConsume[tile] = toConsume[tile] - 1
  else
    table.insert(newPool, tile)
  end
end
state.pool = newPool

-- Remove each used word from its current owner (players affected by a
-- removal, plus the submitter gaining the new word, get their score
-- recomputed from scratch below — self-healing rather than incremental
-- +/-, so it can never drift out of sync with .words).
local removedByOwner = {}
for _, uw in ipairs(usedWords) do
  removedByOwner[uw.ownerId] = removedByOwner[uw.ownerId] or {}
  removedByOwner[uw.ownerId][uw.word] = (removedByOwner[uw.ownerId][uw.word] or 0) + 1
end

local affected = {}
for i, p in ipairs(state.players) do
  local toRemove = removedByOwner[p.id]
  if toRemove then
    local kept = {}
    for _, w in ipairs(p.words) do
      if toRemove[w] and toRemove[w] > 0 then
        toRemove[w] = toRemove[w] - 1
      else
        table.insert(kept, w)
      end
    end
    p.words = kept
    affected[i] = true
  end
end

table.insert(state.players[submitterIndex].words, word)
affected[submitterIndex] = true

-- Scoring: 1 point at minWordLength, +1 per letter beyond it (see
-- docs/decisions.md "Scoring").
local minWordLength = state.config.minWordLength
for i in pairs(affected) do
  local p = state.players[i]
  local score = 0
  for _, w in ipairs(p.words) do
    score = score + 1 + (#w - minWordLength)
  end
  p.score = score
end

-- Playing/stealing a word also becomes the submitter's tile-turn (see
-- docs/decisions.md "Word play transfers the tile-turn"). The submitter is
-- reachable by construction (they just made an atomic move), so no
-- unreachable-walk is needed here — see apply_turn_tile.lua for that.
state.turnPlayerId = state.players[submitterIndex].id
state.turnDeadline = now + (state.config.turnTimerSec * 1000)

-- Same lazy reset pattern as apply_turn_tile.lua's bank-empty trigger, but
-- only once the idle countdown has actually started (CLAUDE.md "Game-end
-- condition") — a WordPlayed while the bank still has tiles doesn't start
-- it. type() check, not truthy: lua-cjson decodes JSON null as the
-- (truthy) cjson.null sentinel, not Lua nil.
if type(state.endGameDeadline) == 'number' then
  state.endGameDeadline = now + 60000
end

state.seq = seq

local encoded = cjson.encode(state)
-- lua-cjson can't tell an emptied array from an empty object — see
-- apply_turn_tile.lua for the same patch and its test coverage. Both
-- players[].words and pool can go empty here (a word play can fully drain
-- the currently-revealed pool, unlike TurnTile which only ever adds to it).
encoded = string.gsub(encoded, '"words":{}', '"words":[]')
encoded = string.gsub(encoded, '"pool":{}', '"pool":[]')

redis.call('SET', KEYS[1], encoded)
return encoded
