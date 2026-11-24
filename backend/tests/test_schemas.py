from app.schemas import (
    EXPORTED_DEFAULTS_SCHEMAS,
    GENERATION_DEFAULTS,
    AppState,
    GenerationDefaults,
    ModelSpec,
    OutputRecord,
)


def test_app_state_backfills_prompt_seed_and_category_layout_defaults() -> None:
    state = AppState.model_validate(
        {
            "categories": [
                {
                    "id": "subject",
                    "name": "Subject",
                    "prompts": [{"id": "p1", "text": "cat", "extra_lora_ids": []}],
                }
            ]
        }
    )

    assert state.prompt_seed is None
    assert state.editor.visibility_mode == "all"
    # Window geometry and priority have no backend defaults: the frontend applies its own.
    category = state.categories[0]
    assert (category.position, category.size, category.z_index, category.priority) == (None, None, None, None)
    assert state.workspace.model_dump() == {"image": None, "controls": None, "details": None, "used": None}


def test_generation_defaults_are_the_single_source_of_every_backend_default() -> None:
    defaults = GENERATION_DEFAULTS
    state = AppState()
    assert (state.width, state.height, state.steps, state.guidance_scale) == (
        defaults.width,
        defaults.height,
        defaults.steps,
        defaults.guidance_scale,
    )
    assert (state.prompt_seed_behavior, state.image_seed_behavior, state.negative_prompt) == (
        defaults.prompt_seed_behavior,
        defaults.image_seed_behavior,
        defaults.negative_prompt,
    )
    model = ModelSpec(id="m", name="m", path="m.safetensors")
    assert (model.default_width, model.default_height, model.torch_dtype) == (
        defaults.width,
        defaults.height,
        defaults.torch_dtype,
    )
    assert model.source is None


def test_exported_defaults_schemas_have_a_default_for_every_field() -> None:
    assert GenerationDefaults in EXPORTED_DEFAULTS_SCHEMAS
    for model in EXPORTED_DEFAULTS_SCHEMAS:
        missing = [name for name, field in model.model_fields.items() if field.is_required()]
        assert missing == [], f"{model.__name__} fields without default: {missing}"
        assert all(field.default_factory is None for field in model.model_fields.values()), model.__name__


def test_output_record_backfills_prompt_and_image_seed_defaults() -> None:
    output = OutputRecord.model_validate(
        {
            "output_id": "0000000001",
            "image_path": "x.png",
            "metadata_path": "x.json",
            "generated_at": "2026-03-23T00:00:00Z",
            "prompt": "cat",
            "seed": 123,
            "width": 1024,
            "height": 1024,
            "model_id": "model",
        }
    )

    assert output.prompt_seed is None
    assert output.image_seed is None
    assert output.seed == 123
