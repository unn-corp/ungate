<script lang="ts">
	import { Api } from '$shared/api';

	let checking = $state(false);
	let status = $state<Awaited<ReturnType<typeof Api.authGrokStatus>> | null>(null);

	async function verify(): Promise<void> {
		checking = true;
		status = await Api.authGrokVerify().catch((error: unknown) => ({
			installed: false,
			path: 'grok',
			version: null,
			authenticated: false,
			error: error instanceof Error ? error.message : String(error)
		}));
		checking = false;
	}

	void verify();
</script>

<div class="card preset-tonal-surface p-4 space-y-4">
	<div>
		<h3 class="font-semibold">Grok via SuperGrok</h3>
		<p class="text-sm opacity-70">Ungate uses the single account currently authenticated in your local Grok CLI. It never copies or stores Grok OAuth tokens.</p>
	</div>
	<div class="text-sm space-y-1">
		<p><span class="font-medium">CLI:</span> {status?.installed ? 'Installed' : 'Not found'} {status?.version ? `(${status.version})` : ''}</p>
		<p><span class="font-medium">Account:</span> {status?.authenticated === true ? 'Verified SuperGrok login' : status?.authenticated === false ? 'Not authenticated' : 'Not checked'}</p>
		{#if status?.error}<p class="text-error-400">{status.error}</p>{/if}
	</div>
	<div class="flex flex-wrap gap-2">
		<button class="btn preset-filled-primary-500" disabled={checking} onclick={verify}>{checking ? 'Checking…' : 'Verify Grok CLI'}</button>
		<code class="rounded bg-surface-700 px-2 py-1 text-xs select-all">grok login</code>
	</div>
	<p class="text-xs opacity-60">Grok tool actions require a separate Allow once confirmation in Cursor. OpenAI function-tool schemas are not forwarded to Grok.</p>
</div>
