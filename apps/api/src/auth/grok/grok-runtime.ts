import { spawn, spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

import type { ChildProcess } from 'node:child_process';
import type { OpenAIChatRequest } from 'src/types/openai';

export interface GrokStatus {
	installed: boolean;
	path: string;
	version: string | null;
	authenticated: boolean | null;
	error?: string;
}

export class GrokRuntimeError extends Error {}

export class GrokRuntime {
	static status(): GrokStatus {
		const path = this.resolveBinary();
		const result = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
		if (result.error || result.status !== 0) {
			return { installed: false, path, version: null, authenticated: null, error: result.error?.message ?? 'Grok CLI was not found' };
		}
		return { installed: true, path, version: result.stdout.trim() || null, authenticated: null };
	}

	static async verify(): Promise<GrokStatus> {
		const status = this.status();
		if (!status.installed) return status;
		try {
			await this.withConnection('grok-build', async (connection) => {
				await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
				await connection.newSession({ cwd: this.resolveCwd(), mcpServers: [] });
			});
			return { ...status, authenticated: true };
		} catch (error) {
			return { ...status, authenticated: false, error: this.errorMessage(error) };
		}
	}

	static async complete(input: {
		request: OpenAIChatRequest;
		model: string;
		onText: (text: string) => void;
	}): Promise<void> {
		if (input.request.tools?.length) {
			throw new GrokRuntimeError('grok_openai_tools_not_supported: Grok uses native, approval-gated agent tools.');
		}
		if (input.request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type !== 'text'))) {
			throw new GrokRuntimeError('grok_non_text_content_not_supported: Grok ACP requests currently accept text messages only.');
		}
		const prompt = this.toPrompt(input.request);
		await this.withConnection(input.model, async (connection) => {
			await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
			const session = await connection.newSession({ cwd: this.resolveCwd(), mcpServers: [] });
			if (session.models?.currentModelId !== input.model) {
				try {
					await connection.unstable_setSessionModel({ sessionId: session.sessionId, modelId: input.model });
				} catch {
					// Older Grok CLIs select the model only from the spawn arguments.
				}
			}
			const promptResult = await connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: 'text', text: prompt }]
			});
			if (promptResult.stopReason !== 'end_turn') {
				throw new GrokRuntimeError(`Grok stopped without completing the turn (${promptResult.stopReason}).`);
			}
		}, input.onText);
	}

	private static async withConnection(
		model: string,
		run: (connection: acp.ClientSideConnection) => Promise<void>,
		onText: (text: string) => void = () => {}
	): Promise<void> {
		const binary = this.resolveBinary();
		const child = this.spawn(binary, model);
		if (!child.stdin || !child.stdout) {
			child.kill();
			throw new GrokRuntimeError('Unable to start Grok CLI with ACP stdio.');
		}

		const client: acp.Client = {
			requestPermission: async (params) => this.requestPermission(params),
			sessionUpdate: async (params) => {
				const update = params.update;
				if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
					onText(update.content.text);
				}
			}
		};
		const stream = acp.ndJsonStream(
			Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
			Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
		);
		const connection = new acp.ClientSideConnection(() => client, stream);

		try {
			await run(connection);
		} finally {
			child.stdin.end();
			child.kill('SIGTERM');
		}
	}

	private static spawn(binary: string, model: string): ChildProcess {
		const { XAI_API_KEY: _xaiApiKey, ...environment } = process.env;
		return spawn(binary, ['agent', '--model', model, '--no-leader', 'stdio'], {
			cwd: this.resolveCwd(),
			env: { ...environment, GROK_OAUTH2_REFERRER: 'ungate' },
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true
		});
	}

	private static async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
		const url = process.env.UNGATE_GROK_APPROVAL_URL;
		const token = process.env.UNGATE_GROK_APPROVAL_TOKEN;
		if (!url || !token) return { outcome: { outcome: 'cancelled' } };
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 65_000);
		try {
			const response = await fetch(url, {
				method: 'POST',
				signal: controller.signal,
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({ title: params.toolCall.title, rawInput: params.toolCall.rawInput, options: params.options })
			});
			const body = (await response.json().catch(() => null)) as { optionId?: string | null } | null;
			const option = params.options.find((item) => item.kind === 'allow_once' && item.optionId === body?.optionId);
			return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
		} finally {
			clearTimeout(timeout);
		}
	}

	private static resolveBinary(): string {
		return process.env.UNGATE_GROK_BIN?.trim() || 'grok';
	}

	private static resolveCwd(): string {
		return process.env.UNGATE_GROK_WORKSPACE?.trim() || process.cwd();
	}

	private static toPrompt(request: OpenAIChatRequest): string {
		return request.messages
			.map((message) => {
				const content = typeof message.content === 'string' ? message.content : message.content?.map((part) => part.text ?? '').join('') ?? '';
				if (!content) return '';
				return `${message.role.toUpperCase()}: ${content}`;
			})
			.filter(Boolean)
			.join('\n\n');
	}

	private static errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}
