// Named aliases of the generated backend schemas (src/api/schema.gen.ts, from backend/app/schemas.py).
// Import shared data types from here; never re-declare them by hand.
// `*-Output` schemas are what the backend returns (every field present); `*-Input` what it accepts.
import type { components } from './schema.gen';

type Schemas = components['schemas'];

// Library
export type ModelSpec = Schemas['ModelSpec-Output'];
export type ModelSpecInput = Schemas['ModelSpec-Input'];
export type LoRASpec = Schemas['LoRASpec'];
export type LibraryState = Schemas['LibraryState'];
export type TorchDType = ModelSpec['torch_dtype'];

// Forbidden rules (also the persisted format of the forbidden-rules store)
export type ForbiddenMatcher = Schemas['ForbiddenMatcher'];
export type ForbiddenRule = Schemas['ForbiddenRule'];
export type MatcherKind = ForbiddenMatcher['kind'];

// Legacy app_state.json (read once at bootstrap to seed stores that were never persisted)
export type AppState = Schemas['AppState'];
export type LegacyPromptCategory = Schemas['PromptCategory'];
export type LegacyPromptEntry = Schemas['PromptEntry'];
export type LegacyPaneLayout = Schemas['PaneLayout'];
export type SeedBehavior = AppState['prompt_seed_behavior'];

// Outputs / generation
export type GenerationSelection = Schemas['GenerationSelection-Output'];
export type GenerationSelectionInput = Schemas['GenerationSelection-Input'];
export type OutputRecord = Schemas['OutputRecord'];
export type OutputIndex = Schemas['OutputIndex'];
export type GenerateRequest = Schemas['GenerateRequest'];

// Background tasks (WebSocket /ws/tasks)
export type GenerationTaskEvent = Schemas['GenerationTaskEvent'];
export type DownloadTaskEvent = Schemas['DownloadTaskEvent'];
export type TaskSnapshot = Schemas['TaskSnapshot'];
export type TaskEvent = TaskSnapshot['events'][number];
export type TaskEventType = TaskEvent['type'];
export type GenerationStage = GenerationTaskEvent['stage'];

// Persisted stores / bootstrap
export type PersistedStoreEnvelope = Schemas['PersistedStoreEnvelope-Output'];
export type PersistedStoreEnvelopeInput = Schemas['PersistedStoreEnvelope-Input'];
export type BootstrapResponse = Schemas['BootstrapResponse'];
