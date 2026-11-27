// Named aliases of the generated backend schemas (src/api/schema.gen.ts, from backend/app/schemas.py).
// Import shared data types from here; never re-declare them by hand.
// `*-Output` schemas are what the backend returns (every field present); `*-Input` what it accepts.
import type { components } from './schema.gen';

type Schemas = components['schemas'];

// Library
export type ModelSpec = Schemas['ModelSpec-Output'];
export type ModelSpecInput = Schemas['ModelSpec-Input'];
/** A LoRA library entry. */
export type LoRASpec = Schemas['LoRASpec'];
export type LibraryState = Schemas['LibraryState'];
export type TorchDType = ModelSpec['torch_dtype'];
/** Provenance of a library entry installed from an online provider (null for local files). */
export type ModelSource = Schemas['ModelSource'];
export type GenerationDefaults = Schemas['GenerationDefaults'];

// Per-LoRA weights (backend LoraWeight: the one representation used by the library store selection, the
// generation request, output metadata and the runtime call; range/default in LORA_WEIGHT_DEFAULTS).
export type LoraWeight = Schemas['LoraWeight-Output'];
/** LoraWeight as a request accepts it (weight optional: LORA_WEIGHT_DEFAULTS.weight). A LoraWeight is one. */
export type LoraWeightInput = Schemas['LoraWeight-Input'];
export type LoraWeightDefaults = Schemas['LoraWeightDefaults'];
/** A library LoRA requested for a generation: LoRASpec fields + weight. */
export type GenerationLoRA = Schemas['GenerationLoRA'];

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
/** The character active for an output and how its reference images were used (OutputRecord.character). */
export type OutputCharacter = Schemas['OutputCharacter'];
export type OutputReference = Schemas['OutputReference'];

// Background tasks (WebSocket /ws/tasks; the co-writer's CodexEvent messages come over the same socket)
export type GenerationTaskEvent = Schemas['GenerationTaskEvent'];
export type DownloadTaskEvent = Schemas['DownloadTaskEvent'];
export type TaskSnapshot = Schemas['TaskSnapshot'];
export type TaskEvent = TaskSnapshot['events'][number];
export type TaskEventType = TaskEvent['type'];
export type GenerationStage = GenerationTaskEvent['stage'];
export type DownloadStage = DownloadTaskEvent['stage'];

// Model library (online providers, installs)
export type ModelKind = InstalledModel['kind'];
export type ModelArchitecture = NonNullable<BaseModelOption['architecture']>;
export type ModelSort = ModelSearchQuery['sort'];
export type ModelDirs = Schemas['ModelDirs'];
export type BaseModelOption = Schemas['BaseModelOption'];
export type ModelProviderInfo = Schemas['ModelProviderInfo'];
export type ModelLibraryInfo = Schemas['ModelLibraryInfo'];
export type ModelSearchQuery = Schemas['ModelSearchQuery'];
export type ModelSearchPage = Schemas['ModelSearchPage'];
export type RemoteModel = Schemas['RemoteModel'];
export type RemoteModelVersion = Schemas['RemoteModelVersion'];
export type RemoteFile = Schemas['RemoteFile'];
export type PreviewImage = Schemas['PreviewImage'];
export type InstallRequest = Schemas['InstallRequest'];
export type InstallResponse = Schemas['InstallResponse'];
export type InstallState = InstallResponse['state'];
export type InstalledModel = Schemas['InstalledModel'];
export type InstallJob = Schemas['InstallJob'];

// Image library (online images, their models, favorites)
export type ImageSearchQuery = Schemas['ImageSearchQuery'];
export type ImageSort = ImageSearchQuery['sort'];
export type ImagePeriod = ImageSearchQuery['period'];
export type ImageSearchPage = Schemas['ImageSearchPage'];
export type RemoteImage = Schemas['RemoteImage'];
export type ImageGenerationParams = Schemas['ImageGenerationParams'];
export type ImageResource = Schemas['ImageResource'];
export type ResolveImageResourcesRequest = Schemas['ResolveImageResourcesRequest'];
export type ResolvedImageResource = Schemas['ResolvedImageResource'];
export type FavoriteImage = Schemas['FavoriteImage'];

// Characters (backend-owned collection, /api/characters) and their reference images (IP-Adapter, /api/ip-adapters)
export type Character = Schemas['Character'];
/** The editable fields of a character (PUT body; base of CharacterCreateRequest). */
export type CharacterDraft = Schemas['CharacterDraft'];
export type CharacterCreateRequest = Schemas['CharacterCreateRequest'];
export type CharacterCollection = Schemas['CharacterCollection'];
export type CharacterImage = Schemas['CharacterImage'];
/** Where a character image is imported from (discriminated by `kind`). */
export type CharacterImageSource = Schemas['CharacterImageRequest']['source'];
export type CharacterImageSourceKind = CharacterImageSource['kind'];
export type ReferenceFocus = Schemas['ReferenceDefaults']['focus'];
export type ReferenceDefaults = Schemas['ReferenceDefaults'];
export type IpAdapterStatus = Schemas['IpAdapterStatus'];
export type IpAdapterVariant = Schemas['IpAdapterVariant'];
export type IpAdapterFile = Schemas['IpAdapterFile'];
export type IpAdapterFileRole = IpAdapterFile['role'];
export type ReferenceSupport = Schemas['ReferenceSupport'];
export type IpAdapterInstallResponse = Schemas['IpAdapterInstallResponse'];

// Stories (backend-owned illustrated storyboards, /api/stories)
export type Story = Schemas['Story'];
export type StoryCollection = Schemas['StoryCollection'];
export type StoryCreateRequest = Schemas['StoryCreateRequest'];
/** Only the fields sent change (PATCH /api/stories/{story_id}). */
export type StoryPatch = Schemas['StoryPatch'];
export type Scene = Schemas['Scene'];
/** A sub-prompt chosen for one scene (pinned like the characters' tags, src/domain/stories.ts). */
export type SceneLock = Schemas['SceneLock'];
export type SceneVariant = Schemas['SceneVariant'];
export type SceneCreateRequest = Schemas['SceneCreateRequest'];
/** Only the fields sent change (PATCH /api/stories/{story_id}/scenes/{scene_id}); character_ids and seed accept null. */
export type ScenePatch = Schemas['ScenePatch'];
/** The story scene a generation illustrates (GenerateRequest.story). */
export type StoryLink = Schemas['StoryLink'];
/** The story scene an output was generated for (OutputRecord.story). */
export type OutputStory = Schemas['OutputStory'];

// Co-writer (the user's Codex, backend app/routers/codex.py; its events come over /ws/tasks)
export type CodexStatus = Schemas['CodexStatus'];
export type CodexState = CodexStatus['state'];
export type CodexModelOption = Schemas['CodexModelOption'];
/** Only the fields sent change; null clears (auto-detect, the default model). */
export type CodexSettingsUpdate = Schemas['CodexSettingsUpdate'];
export type CodexConversation = Schemas['CodexConversation'];
export type CodexEntry = Schemas['CodexEntry'];
export type CodexEntryKind = CodexEntry['kind'];
export type CodexEntryStatus = CodexEntry['status'];
export type CodexTurnRequest = Schemas['CodexTurnRequest'];
export type CodexToolResult = Schemas['CodexToolResult'];
/** A WebSocket message of the co-writer (discriminated by `kind`). */
export type CodexEvent = Schemas['CodexEvent'];
export type CodexEventKind = CodexEvent['kind'];
/** A tool call for this window to run (discriminated by `tool`; its `arguments` are validated by the backend). */
export type CodexToolCall = Schemas['CodexToolCallEvent']['call'];
export type CodexToolName = CodexToolCall['tool'];
/** The arguments of one tool. */
export type CodexToolArguments<T extends CodexToolName> = Extract<CodexToolCall, { tool: T }>['arguments'];

// Persisted stores / bootstrap
export type PersistedStoreEnvelope = Schemas['PersistedStoreEnvelope-Output'];
export type PersistedStoreEnvelopeInput = Schemas['PersistedStoreEnvelope-Input'];
export type BootstrapResponse = Schemas['BootstrapResponse'];
