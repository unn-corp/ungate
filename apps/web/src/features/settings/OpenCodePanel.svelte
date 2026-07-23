<script lang="ts">
	import type { ModelMappingConfig } from '@ungate/shared/frontend';

	let { port, apiKey, models }: { port: string; apiKey: string; models: ModelMappingConfig[] } = $props();
	let copied = $state<string | null>(null);

	const config = $derived(
		JSON.stringify(
			{
				$schema: 'https://opencode.ai/config.json',
				provider: {
					ungate: {
						npm: '@ai-sdk/openai-compatible',
						name: 'Ungate (local)',
						options: {
							baseURL: `http://127.0.0.1:${port || '<ungate-port>'}/v1`,
							...(apiKey.trim() ? { apiKey: '{env:UNGATE_API_KEY}' } : {})
						},
						models: Object.fromEntries(models.map((model) => [model.id, { name: model.label }]))
					}
				}
			},
			null,
			2
		)
	);

	async function copy(value: string, kind: string): Promise<void> {
		await navigator.clipboard.writeText(value);
		copied = kind;
		setTimeout(() => (copied = null), 2_000);
	}
</script>

<section class="card preset-tonal-surface p-4 space-y-3">
	<div>
		<h2 class="font-semibold">OpenCode</h2>
		<p class="text-sm opacity-70">OpenCode connects directly to Ungate on this computer. A Cloudflare tunnel is not needed.</p>
	</div>
	<p class="text-sm">Copy this into your global or project <code>opencode.jsonc</code>. Ungate never edits OpenCode files.</p>
	<pre class="max-h-64 overflow-auto rounded bg-surface-900 p-3 text-xs"><code>{config}</code></pre>
	<button class="btn preset-filled-primary-500" onclick={() => copy(config, 'config')}>{copied === 'config' ? 'Copied' : 'Copy OpenCode config'}</button>
	{#if apiKey.trim()}
		<div class="space-y-2 border-t border-surface-600 pt-3">
			<p class="text-sm">Before starting OpenCode, export the Ungate proxy key in your shell.</p>
			<button class="btn preset-tonal-primary" onclick={() => copy(`export UNGATE_API_KEY='${apiKey.replaceAll("'", "'\\\"'\\\"'")}'`, 'key')}>{copied === 'key' ? 'Copied' : 'Copy key export'}</button>
		</div>
	{:else}
		<p class="text-xs opacity-60">No Ungate proxy key is enabled, so the generated config omits <code>apiKey</code>.</p>
	{/if}
	<p class="text-xs opacity-60">Then run <code>/models</code> in OpenCode and select <code>ungate/grok-build</code> or another mapped Ungate model.</p>
</section>
