export type SeedMode = 'random' | 'manual';
export type SeedAdvanceMode = 'keep' | 'increment' | 'randomize';
export type SeedBehavior = 'fixed' | 'increment' | 'randomize' | 'per_category_cycle';

export type PromptCategorySeedStateEntry = {
	seed: number;
	remaining: number;
	prompt_count: number;
};
export type MatcherKind = 'specific' | 'contains' | 'tag';
export type PaneKey = 'image' | 'browser' | 'controls' | 'details' | 'used';
export type EditorTargetKind = 'none' | 'category-name' | 'category-condition' | 'category-priority' | 'sub-prompt' | 'category-bulk-prompts';
export type EditorVisibilityMode = 'all' | 'categories-only' | 'panes-only';
export type PromptStoredState = 'normal' | 'skip' | 'lock';
export type PromptUiState = PromptStoredState | 'indirectly-disabled';
export type CategoryStoredState = 'normal' | 'skip';
export type CategoryUiState = CategoryStoredState | 'indirectly-disabled';

export type LoRASpec = {
	id: string;
	name: string;
	path: string;
};

export type ModelSpec = {
	id: string;
	name: string;
	path: string;
	default_width: number;
	default_height: number;
	torch_dtype: 'float16' | 'bfloat16' | 'float32';
};

export type PromptEntry = {
	id: string;
	text: string;
	state: PromptStoredState;
	skipped?: boolean;
	extra_lora_ids: string[];
};

export type CategoryPosition = {
	x: number;
	y: number;
};

export type CategorySize = {
	width: number;
	height: number;
};

export type PromptCategory = {
	id: string;
	name: string;
	state: CategoryStoredState;
	muted?: boolean;
	priority: string;
	activation_text: string;
	locked_prompt_id?: string | null;
	locked_prompt_text?: string | null;
	position: CategoryPosition;
	size: CategorySize;
	z_index: number;
	prompts: PromptEntry[];
};

export type ForbiddenMatcher = {
	kind: MatcherKind;
	category_name: string | null;
	prompt_text: string | null;
	contains_text: string | null;
	tag_text?: string | null;
};

export type ForbiddenRule = {
	left: ForbiddenMatcher;
	right: ForbiddenMatcher;
};

export type EditorTarget = {
	kind: EditorTargetKind;
	category_id: string | null;
	prompt_id: string | null;
};

export type EditorState = {
	overlays_hidden: boolean;
	visibility_mode: EditorVisibilityMode;
	selected_category_id: string | null;
	selected_prompt_id: string | null;
	edit_session_id: number;
	editing_target: EditorTarget;
};

export type PaneLayout = {
	x: number;
	y: number;
	width: number;
	height: number;
	z_index: number;
};

export type WorkspaceLayout = {
	image: PaneLayout;
	browser: PaneLayout;
	controls: PaneLayout;
	details: PaneLayout;
	used: PaneLayout;
};

export type AppState = {
	categories: PromptCategory[];
	forbidden_rules: ForbiddenRule[];
	last_model_id: string | null;
	last_lora_ids: string[];
	last_model_dir: string | null;
	last_lora_dir: string | null;
	width: number;
	height: number;
	steps: number;
	guidance_scale: number;
	prompt_seed: number | null;
	seed: number | null;
	seed_mode: SeedMode;
	seed_advance_mode: SeedAdvanceMode;
	prompt_seed_behavior: SeedBehavior;
	image_seed_behavior: SeedBehavior;
	negative_prompt: string;
	workspace: WorkspaceLayout;
	editor: EditorState;
	last_output_id: string | null;
};

export type LibraryState = {
	models: ModelSpec[];
	loras: LoRASpec[];
};

export type BootstrapResponse = {
	state: AppState;
	library: LibraryState;
	data_dir: string;
	outputs: OutputSummary[];
	current_output: OutputRecord | null;
};

export type GenerationSelection = {
	category_name: string;
	prompt_text: string;
	locked: boolean;
	induced_lora_ids: string[];
};

export type UsedAssociationMode = 'prompt' | 'category' | 'tag';

export type ForbiddenAssociationEndpoint = {
	mode: UsedAssociationMode;
	selection: GenerationSelection;
	tag_text?: string | null;
};

export type GenerateRequest = {
	model: ModelSpec;
	loras: LoRASpec[];
	prompt: string;
	selections: GenerationSelection[];
	width: number;
	height: number;
	steps: number;
	guidance_scale: number;
	prompt_seed: number | null;
	seed: number | null;
	negative_prompt: string;
};

export type OutputSummary = {
	output_id: string;
	image_path: string;
	metadata_path: string;
	generated_at: string;
	prompt: string;
	seed: number;
	width: number;
	height: number;
};

export type OutputRecord = OutputSummary & {
	negative_prompt: string;
	steps: number;
	guidance_scale: number;
	model_id: string;
	prompt_seed: number | null;
	image_seed: number | null;
	active_lora_ids: string[];
	selections: GenerationSelection[];
	image_base64: string | null;
};

export type GenerateResponse = OutputRecord;

export type ProgressEvent = {
	stage: 'idle' | 'loading_model' | 'loading_loras' | 'sampling' | 'saving' | 'complete' | 'error';
	message: string;
	current_step: number;
	total_steps: number;
};

declare global {
	interface Window {
		promptWeaverDesktop?: {
			platform: string;
			pickDirectory: (options?: { defaultPath?: string | null; title?: string }) => Promise<string | null>;
			pickFile: (options?: { defaultPath?: string | null; title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
			pickFiles: (options?: { defaultPath?: string | null; title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string[]>;
			getUserDataPath: () => Promise<string>;
			fsAccess: (filePath: string) => Promise<true>;
			fsMkdir: (directoryPath: string) => Promise<true>;
			fsReadFileUtf8: (filePath: string) => Promise<string>;
			fsReadFileBase64: (filePath: string) => Promise<string>;
			fsWriteFileUtf8: (filePath: string, data: string) => Promise<true>;
			fsReaddir: (directoryPath: string) => Promise<Array<{
				name: string;
				isFile: boolean;
				isDirectory: boolean;
			}>>;
			watchDirectory: (
				directoryPath: string,
				callback: (event: { eventType: 'rename' | 'change'; fileName: string }) => void,
			) => (() => void) | void;
			pathJoin: (...parts: string[]) => string;
			pathDirname: (filePath: string) => string;
			onCommand?: (callback: (command: string) => void) => (() => void) | void;
		};
	}
}
