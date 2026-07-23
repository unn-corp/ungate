import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import * as vscode from 'vscode';

interface PermissionOption {
	optionId: string;
	kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

interface PermissionRequest {
	title?: string;
	rawInput?: unknown;
	options?: PermissionOption[];
}

/** A short-lived, loopback-only bridge from the API child process to Cursor UI. */
export class GrokApprovalBridge {
	private server: ReturnType<typeof createServer> | null = null;
	private port: number | null = null;
	private readonly token = randomBytes(32).toString('hex');

	constructor(private readonly onLog: (message: string) => void) {}

	async start(): Promise<void> {
		if (this.server) return;
		this.server = createServer((request, response) => void this.handle(request, response));
		await new Promise<void>((resolve, reject) => {
			this.server!.once('error', reject);
			this.server!.listen(0, '127.0.0.1', () => {
				this.server!.off('error', reject);
				const address = this.server!.address();
				this.port = typeof address === 'object' && address ? address.port : null;
				resolve();
			});
		});
	}

	getEnvironment(): NodeJS.ProcessEnv {
		if (!this.port) return {};
		return {
			UNGATE_GROK_APPROVAL_URL: `http://127.0.0.1:${this.port}/permission`,
			UNGATE_GROK_APPROVAL_TOKEN: this.token
		};
	}

	async dispose(): Promise<void> {
		if (!this.server) return;
		const server = this.server;
		this.server = null;
		this.port = null;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private async handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
		if (request.method !== 'POST' || request.url !== '/permission' || !this.hasValidToken(request.headers.authorization)) {
			response.writeHead(403).end();
			return;
		}
		const payload = await this.readBody(request).catch(() => null);
		if (!payload) {
			response.writeHead(400).end();
			return;
		}
		const allow = payload.options?.find((option) => option.kind === 'allow_once');
		const detail = payload.rawInput === undefined ? '' : `\n${this.compact(payload.rawInput)}`;
		this.onLog(`[grok] permission requested: ${payload.title ?? 'tool call'}`);
		const result = await Promise.race([
			vscode.window.showWarningMessage(`${payload.title ?? 'Grok requests permission'}${detail}`, { modal: true }, 'Allow once', 'Deny'),
			new Promise<string | undefined>((resolve) => setTimeout(() => resolve(undefined), 60_000))
		]);
		const optionId = result === 'Allow once' ? allow?.optionId ?? null : null;
		this.onLog(`[grok] permission ${optionId ? 'allowed once' : 'denied'}: ${payload.title ?? 'tool call'}`);
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ optionId }));
	}

	private hasValidToken(value: string | undefined): boolean {
		const received = value?.replace(/^Bearer\s+/i, '');
		return !!received && received.length === this.token.length && timingSafeEqual(Buffer.from(received), Buffer.from(this.token));
	}

	private async readBody(request: import('node:http').IncomingMessage): Promise<PermissionRequest> {
		let body = '';
		for await (const chunk of request) {
			body += String(chunk);
			if (body.length > 32_768) throw new Error('Request too large');
		}
		return JSON.parse(body) as PermissionRequest;
	}

	private compact(value: unknown): string {
		try {
			const text = JSON.stringify(value);
			return text.length > 1_500 ? `${text.slice(0, 1_500)}…` : text;
		} catch {
			return '[unavailable details]';
		}
	}
}
