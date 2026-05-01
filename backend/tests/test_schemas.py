from app.schemas import AppState, OutputRecord


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
    assert state.categories[0].size.width == 320
    assert state.categories[0].size.height == 360
    assert state.categories[0].z_index == 50


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
