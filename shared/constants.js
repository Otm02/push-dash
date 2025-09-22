export const ARENA_W = 1024
export const ARENA_H = 768
// Units per second movement speed for player shape
export const MAX_SPEED = 200
// Player visual/physics sizing (square)
export const PLAYER_SIZE = 64
export const PLAYER_HALF = PLAYER_SIZE / 2

// Dash tuning
export const DASH_SPEED = 500 // units/sec during dash
// Dash variants based on hold duration
export const DASH_SHORT_DURATION_MS = 250 // ms (light tap)
export const DASH_LONG_DURATION_MS = 1000 // ms (long hold)
export const DASH_HOLD_THRESHOLD_MS = 180 // ms threshold between short vs long
// Backward-compat (legacy single duration); prefer using the specific ones above
export const DASH_DURATION_MS = DASH_LONG_DURATION_MS
export const DASH_COOLDOWN_MS = 700 // ms
export const STUN_MS = 200 // ms on target when hit
export const RECOIL_MS = 50 // ms slow on attacker after hit
export const RECOIL_SPEED_SCALE = 0.5 // speed multiplier during recoil
export const KNOCKBACK_SCALE = 0.7 // portion of remaining dash distance applied to target
// Global simulation tickrate (ms per tick). Server sim and client input send throttle should match.
export const TICK_MS = 50
export const TICK_HZ = 1000 / TICK_MS

// Difficulty ramp (wave) duration in seconds
export const WAVE_SECONDS = 20

// Hazards tuning
// Dagger spawn/despawn margin outside arena (pixels)
export const DAGGER_MARGIN = 48
// Trap 'off' phase duration before despawn (ms)
export const TRAP_OFF_MS = 1000
