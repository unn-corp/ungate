-- Migration 0008: make SuperGrok available as an opt-in mapped model
INSERT OR IGNORE INTO `model_mappings` (`id`, `label`, `provider`, `upstream_model`, `reasoning_budget`, `sort_order`)
VALUES ('grok-build', 'Grok Build (SuperGrok)', 'grok', 'grok-build', NULL, 1000);
