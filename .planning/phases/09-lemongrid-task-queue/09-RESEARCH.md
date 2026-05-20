# Phase 9: LemonGrid Task Queue Information - Research

**Researched:** 2026-05-20
**Domain:** LemonGrid platform queue status integration (UXP Plugin -> FastAPI Platform)
**Confidence:** HIGH

## Summary

This research covers integrating LemonGrid platform-wide task queue information into the Photoshop ComfyUI Plugin's Cluster Mode. The LemonGrid backend already provides two verified API endpoints for queue information: `GET /api/v1/tasks/queue` returns a platform-wide queue summary (queued count, running count, active nodes, average wait time), and `GET /api/v1/tasks/{task_id}/eta` returns per-task ETA estimates (queue position, estimated wait seconds, average duration). The plugin already has `queue_position` in its `LemonGridTaskStatus` interface but does not yet surface the ETA or the platform-wide queue summary to users.

The LemonGrid frontend (TaskCard.tsx) already implements a reference pattern: it fetches per-task ETA every 30 seconds for QUEUED/RUNNING tasks and displays queue position + estimated wait minutes alongside a progress bar. The PS plugin should follow a similar pattern but adapted for its compact MiniTaskList UI. Additionally, the plugin should display a cluster queue status badge (parallel to the existing Direct Mode queue badge) showing platform-wide queue depth and estimated wait time.

**Primary recommendation:** Add two new methods to `LemonGridClient` (`getQueueSummary` and `getTaskETA`), add queue summary state to `lemongridStore`, poll the queue summary periodically when in Cluster Mode, and enhance `MiniTaskList` to show per-task ETA. Add a cluster queue status badge in the preview section header (reusing the existing `queue-status-badge` CSS pattern).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Queue summary API call | API / Backend | - | LemonGrid REST API provides GET /api/v1/tasks/queue |
| Per-task ETA fetch | API / Backend | - | LemonGrid REST API provides GET /api/v1/tasks/{task_id}/eta |
| Queue state management | Frontend (Zustand) | - | lemongridStore already tracks tasks; add queue summary fields |
| Queue badge display | Browser / Client | - | Preview section UI element in Draw.tsx |
| Per-task ETA display | Browser / Client | - | MiniTaskList component enhancement |
| Queue data refresh | Browser / Client | - | Polling timer in Draw.tsx useEffect |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | ^5.x | State management | Already in use for lemongridStore |
| React | ^18.x | UI rendering | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lemongridFetch | existing | Authenticated API proxy | All LemonGrid API calls |
| ensureValidToken | existing | Token refresh | Before authenticated requests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling queue summary | WebSocket queue updates | WebSocket only sends task-level events, no queue summary events. Polling is simpler and the data changes slowly. |

**Installation:**
No new packages needed. This phase uses existing infrastructure exclusively.

## Architecture Patterns

### System Architecture Diagram

```
Draw.tsx (Cluster Mode)
  |
  |-- Queue Status Badge (preview section)
  |     |
  |     +-- lemongridStore.queueSummary
  |           |
  |           +-- LemonGridClient.getQueueSummary()
  |                 |
  |                 +-- GET /api/v1/tasks/queue  (poll every 15s)
  |
  |-- MiniTaskList (below Generate button)
        |
        +-- Per-task item (QUEUED state)
              |
              +-- lemongridStore.tasks[id].queuePosition
              +-- lemongridStore.tasks[id].etaMinutes
                    |
                    +-- LemonGridClient.getTaskETA(taskId)
                          |
                          +-- GET /api/v1/tasks/{id}/eta  (poll every 30s for active tasks)
```

### Recommended Project Structure
```
code/webapp/src/
  services/lemongrid.ts          # ADD: getQueueSummary(), getTaskETA()
  stores/lemongridStore.ts       # ADD: queueSummary state + actions
  components/MiniTaskList.tsx     # MODIFY: show ETA in QUEUED items
  components/MiniTaskList.css     # MODIFY: ETA styling
  pages/Draw.tsx                  # MODIFY: cluster queue badge + polling useEffect
  pages/Draw.css                  # MODIFY: cluster queue badge styles (reuse existing)
```

### Pattern 1: Queue Summary Polling
**What:** Periodically fetch platform-wide queue summary when in Cluster Mode with active tasks.
**When to use:** When user is in Cluster Mode and has active tasks.
**Example:**
```typescript
// Source: [VERIFIED - based on LemonGrid backend tasks.py line 206-213]
interface TaskQueueSummary {
  queued_count: number;        // Tasks waiting in Redis ZSET queue
  running_count: number;       // Tasks currently executing on GPU nodes
  completed_today: number;     // Tasks completed since midnight UTC
  failed_today: number;        // Tasks failed since midnight UTC
  active_nodes: number;        // GPU compute nodes currently online
  avg_wait_seconds: number | null;    // Estimated wait = (queued/active_nodes) * avg_duration
  avg_duration_seconds: number | null; // Average task duration from last 100 completed tasks
}
```

### Pattern 2: Per-Task ETA Fetch
**What:** Fetch estimated wait time for individual queued tasks.
**When to use:** For QUEUED tasks to show position and ETA.
**Example:**
```typescript
// Source: [VERIFIED - tasks.py line 353-383]
interface TaskETAResponse {
  task_id: string;
  queue_position: number;        // 1-based position in Redis ZSET
  total_workers: number;         // Total GPU slots across online nodes
  avg_duration_seconds: float;   // Moving average of recent task durations
  estimated_wait_seconds: float; // (queue_position / total_workers) * avg_duration
}
```

### Pattern 3: Cluster Queue Status Badge
**What:** Show platform queue status in the preview section header, parallel to existing Direct Mode badge.
**When to use:** When in Cluster Mode and queue has tasks.
**Example:**
```typescript
// Reuse existing queue-status-badge CSS class pattern
// Only show in cluster mode when there are queued/running tasks
{connectionMode === 'cluster' && queueSummary && (queueSummary.queued_count > 0 || queueSummary.running_count > 0) && (
  <div className="queue-status-badge">
    <span className="queue-dot"></span>
    <span className="queue-text">
      {queueSummary.running_count > 0 && `${queueSummary.running_count} 运行中`}
      {queueSummary.running_count > 0 && queueSummary.queued_count > 0 && ' · '}
      {queueSummary.queued_count > 0 && `${queueSummary.queued_count} 排队中`}
      {queueSummary.avg_wait_seconds != null && queueSummary.queued_count > 0 && ` · ~${Math.ceil(queueSummary.avg_wait_seconds / 60)}分钟`}
    </span>
  </div>
)}
```

### Anti-Patterns to Avoid
- **Fetching ETA for all tasks simultaneously:** Only fetch ETA for active tasks (QUEUED/PENDING). Completed/failed/cancelled tasks don't need ETA. [VERIFIED - TaskCard.tsx line 49 only fetches for RUNNING/QUEUED]
- **Polling queue summary too frequently:** Queue summary changes slowly. 15-30 seconds is sufficient. Do not poll every second like task status. [ASSUMED]
- **Showing platform queue info in Direct Mode:** Queue badge is mode-specific. Cluster queue info is irrelevant when connected to a single ComfyUI instance. [VERIFIED - existing queue badge already branches on `connectionMode !== 'cluster'`]
- **Duplicating queue state across stores:** Queue summary belongs in `lemongridStore` alongside tasks, not in a separate store. [VERIFIED - lemongridStore is the canonical location for all LemonGrid state]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ETA calculation | Client-side wait time formula | `GET /api/v1/tasks/{task_id}/eta` | Server has access to Redis ZSET rank, active node GPU counts, and moving average durations. Client cannot compute these. [VERIFIED - dispatch_service.py estimate_eta uses Redis ZRANK] |
| Queue depth counting | Client-side task counting | `GET /api/v1/tasks/queue` | Server counts from Redis ZSET (queued) and database (running/completed_today). Client only sees its own tasks. [VERIFIED - scheduler_service.py get_queue_summary] |
| Average duration tracking | Client-side timing | Server's ETA_MOVING_AVG_KEY | Server maintains a Redis-based moving average of last N task durations. |

**Key insight:** The plugin only tracks its own tasks in `lemongridStore.tasks`. It cannot know about other users' tasks or the total queue depth. Both the queue summary and ETA APIs must come from the LemonGrid server.

## Common Pitfalls

### Pitfall 1: ETA Returns Null for Non-Queued Tasks
**What goes wrong:** Calling `GET /api/v1/tasks/{task_id}/eta` for tasks that are already RUNNING or COMPLETED returns 404 "not in queue."
**Why it happens:** The ETA calculation uses Redis ZRANK which only works for tasks still in the queue ZSET. Once a task starts executing, it's removed from the ZSET.
**How to avoid:** Only call getTaskETA for tasks in QUEUED or PENDING status. For RUNNING tasks, the progress percentage is sufficient. [VERIFIED - dispatch_service.py line 281 returns None if not in queue]
**Warning signs:** 404 errors in console when fetching ETA for running tasks.

### Pitfall 2: Queue Summary Stale Data
**What goes wrong:** Showing queue count that's significantly different from reality because polling interval is too long.
**Why it happens:** Queue depth can change rapidly when multiple users submit tasks simultaneously.
**How to avoid:** Poll at 15-second intervals when user has active tasks. Stop polling when no active tasks. Show last-updated timestamp if desired. [ASSUMED - 15s is a balance between freshness and server load]
**Warning signs:** Users report "it said 2 in queue but mine didn't start."

### Pitfall 3: Confusing Platform Queue vs User's Tasks
**What goes wrong:** User sees "5 running" in queue badge but only has 1 task, causing confusion.
**Why it happens:** Queue summary is platform-wide (all users), but the mini task list only shows the current user's tasks.
**How to avoid:** Clearly label the queue badge as platform status. Consider wording like "平台: 3 运行中, 2 排队中" to distinguish from the user's own tasks. [ASSUMED]
**Warning signs:** Users ask "why does it say 5 running when I only have 1 task?"

### Pitfall 4: Missing Bridge Proxy for New Endpoints
**What goes wrong:** Calling LemonGrid API directly from webview without Bridge proxy in UXP mode.
**Why it happens:** New API calls need to go through `lemongridFetch` which uses `lemongrid.fetch` Bridge handler in UXP mode.
**How to avoid:** Use `LemonGridClient.fetchJson` (which uses `lemongridFetch` internally) for all new API calls. Do not use raw `fetch`. [VERIFIED - existing LemonGridClient methods all use fetchWithAuth/fetchJson]
**Warning signs:** Network errors in UXP mode but works in browser mode.

## Code Examples

### Adding getQueueSummary to LemonGridClient
```typescript
// Source: [VERIFIED - based on existing LemonGridClient pattern and LemonGrid tasks.py line 206-213]
// Add to LemonGridClient class in code/webapp/src/services/lemongrid.ts

export interface TaskQueueSummary {
  queued_count: number;
  running_count: number;
  completed_today: number;
  failed_today: number;
  active_nodes: number;
  avg_wait_seconds: number | null;
  avg_duration_seconds: number | null;
}

export interface TaskETAResponse {
  task_id: string;
  queue_position: number;
  total_workers: number;
  avg_duration_seconds: number;
  estimated_wait_seconds: number;
}

// Inside LemonGridClient class:
async getQueueSummary(): Promise<TaskQueueSummary> {
  return this.fetchJson<TaskQueueSummary>('/api/v1/tasks/queue');
}

async getTaskETA(taskId: string): Promise<TaskETAResponse> {
  return this.fetchJson<TaskETAResponse>(`/api/v1/tasks/${taskId}/eta`);
}
```

### Adding Queue Summary to lemongridStore
```typescript
// Source: [VERIFIED - based on existing lemongridStore pattern]
// Add to lemongridStore interface and implementation

interface LemonGridState {
  // ... existing fields ...
  queueSummary: TaskQueueSummary | null;
  setQueueSummary: (summary: TaskQueueSummary | null) => void;
}

// In the store implementation:
queueSummary: null,
setQueueSummary: (summary) => set({ queueSummary: summary }),
```

### MiniTaskList ETA Display Enhancement
```typescript
// Source: [VERIFIED - based on LemonGrid TaskCard.tsx pattern]
// Enhanced QUEUED task display in MiniTaskList

{task.status === 'QUEUED' && task.etaMinutes != null && task.etaMinutes > 0 && (
  <span className="eta-text">~{task.etaMinutes}分钟</span>
)}
```

### LemonGrid Frontend Reference: TaskCard ETA Pattern
```typescript
// Source: [VERIFIED - LemonGrid fluxcore-frontend TaskCard.tsx lines 48-74]
// The LemonGrid frontend polls ETA every 30 seconds for QUEUED/RUNNING tasks
useEffect(() => {
  if (task.status !== 'RUNNING' && task.status !== 'QUEUED') return
  let cancelled = false
  const fetchETA = async () => {
    try {
      const eta = await taskApi.getTaskETA(task.id)
      if (!cancelled) {
        if (task.status === 'QUEUED') {
          setQueueInfo({ position: eta.queue_position, total: eta.total_workers })
          const waitMin = Math.ceil(eta.estimated_wait_seconds / 60)
          setEtaMinutes(waitMin > 0 ? waitMin : null)
        }
      }
    } catch { /* ETA not available, ignore */ }
  }
  fetchETA()
  const interval = setInterval(fetchETA, 30000)
  return () => { cancelled = true; clearInterval(interval) }
}, [task.status, task.id])
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No queue visibility | Per-task queue_position in status | Phase 6 | Basic position shown but no ETA |
| Direct Mode queue badge only | Need cluster mode queue badge | Phase 9 | Users need cluster queue info too |

**Deprecated/outdated:**
- None for this phase. This is additive to existing infrastructure.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 15-30 second polling interval for queue summary is sufficient | Architecture Patterns | Users see stale queue counts |
| A2 | Platform queue badge should use wording "平台: X 运行中" to distinguish from user tasks | Common Pitfalls | Users confused about why counts differ from their task list |
| A3 | Queue summary polling should stop when no active tasks | Architecture Patterns | Unnecessary API calls when user is idle |
| A4 | The `estimated_eta` field in task response (from `_task_to_response`) could be used as an alternative to separate ETA API call | Code Examples | May need to verify if this field is populated during QUEUED state |

## Open Questions (RESOLVED)

1. **Should queue summary polling start immediately on Cluster Mode entry, or only when user submits a task?** (RESOLVED)
   - **Decision:** Start polling on Cluster Mode entry if authenticated. Plan 09-02 implements queue summary polling in a useEffect that activates when `connectionMode === 'cluster'` and user is authenticated.
   - **Rationale:** Users benefit from seeing platform load before committing to a task submission.

2. **Should per-task ETA be fetched for PENDING tasks (not yet in Redis queue)?** (RESOLVED)
   - **Decision:** Only fetch ETA for QUEUED tasks. PENDING tasks show "准备入队..." status text.
   - **Rationale:** The ETA API returns 404 for tasks not in the Redis ZSET. PENDING tasks have not entered the queue yet. Plan 09-02 only triggers ETA polling for `status === 'QUEUED'` tasks.

3. **Should the existing `estimated_eta` field from task status response be used instead of separate ETA API?** (RESOLVED)
   - **Decision:** Use the separate `GET /api/v1/tasks/{task_id}/eta` API, not the `estimated_eta` field from task status.
   - **Rationale:** The separate ETA API returns richer data (queue_position, total_workers, avg_duration_seconds, estimated_wait_seconds) vs a single scalar. Using the dedicated endpoint keeps the existing task polling response unchanged and avoids modifying LemonGridTaskStatus interface.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| LemonGrid backend | Queue summary + ETA APIs | - | - | N/A (external service) |
| UXP Bridge (main.js) | API proxy in PS mode | - | - | Browser direct fetch |

**Missing dependencies with no fallback:**
- None (no new dependencies required; uses existing Bridge handlers and lemongridFetch)

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | vitest.config (none found - likely uses defaults from package.json) |
| Quick run command | `cd code/webapp && npx vitest run --reporter=verbose` |
| Full suite command | `cd code/webapp && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| Q-01 | getQueueSummary returns TaskQueueSummary | unit | `npx vitest run src/services/__tests__/lemongrid-queue.test.ts` | Wave 0 |
| Q-02 | getTaskETA returns TaskETAResponse | unit | `npx vitest run src/services/__tests__/lemongrid-queue.test.ts` | Wave 0 |
| Q-03 | lemongridStore queueSummary state management | unit | `npx vitest run src/stores/__tests__/lemongridStore-queue.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/lemongrid-queue.test.ts` - covers getQueueSummary and getTaskETA
- [ ] `src/stores/__tests__/lemongridStore-queue.test.ts` - covers queueSummary state

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JWT via lemongridFetch + ensureValidToken |
| V4 Access Control | yes | Server-side user scoping (users see own tasks only for ETA, queue summary is global) |
| V5 Input Validation | yes | Task ID UUID validation on server |

### Known Threat Patterns for LemonGrid API

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized ETA access | Information Disclosure | Server checks task.user_id == current_user.id [VERIFIED tasks.py line 281-282] |
| Queue summary enumeration | Information Disclosure | Queue summary is global (no user filtering), accessible to any authenticated user |

## Sources

### Primary (HIGH confidence)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\tasks.py` - Queue summary endpoint (line 206-213), ETA endpoint (line 353-383), task status response with estimated_eta field (line 33-65)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\scheduler_service.py` - get_queue_summary implementation (line 127-185)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\dispatch_service.py` - estimate_eta implementation (line 273-303)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\schemas\__init__.py` - TaskQueueSummary schema (line 288-297)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-frontend\src\pages\design\components\TaskCard.tsx` - Reference ETA polling pattern (line 48-74)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-frontend\src\types\api.ts` - TypeScript interfaces for TaskQueueSummary (line 263-271), TaskETA (line 388-394)
- `code\webapp\src\services\lemongrid.ts` - Existing LemonGridClient with fetchJson pattern
- `code\webapp\src\stores\lemongridStore.ts` - Existing store with tasks state
- `code\webapp\src\components\MiniTaskList.tsx` - Existing task list component
- `code\webapp\src\pages\Draw.tsx` - Existing queue badge and cluster mode patterns

### Secondary (MEDIUM confidence)
- `.planning/phases/06-lemongrid-integration/06-RESEARCH.md` - Phase 6 research documenting API mapping including GET /api/v1/tasks/queue and ETA endpoints
- `.planning/phases/06-lemongrid-integration/06-CONTEXT.md` - Phase 6 decisions (D-27: show queue position only, no ETA was deferred)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, reuses existing LemonGridClient + lemongridStore
- Architecture: HIGH - LemonGrid backend APIs verified by reading source code, frontend reference pattern available
- Pitfalls: HIGH - based on verified API behavior (ETA 404 for non-queued tasks, queue summary is platform-wide)
- API compatibility: HIGH - all endpoints verified against running LemonGrid backend code

**Research date:** 2026-05-20
**Valid until:** 30 days (stable - LemonGrid APIs are established)
